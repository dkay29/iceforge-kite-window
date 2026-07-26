/**
 * Best-window selection.
 *
 * Orchestrates candidate generation, hard-rule evaluation, scoring, and
 * status derivation to select the best session window and alternatives for
 * a given day.  Also builds the 15-minute timeline points used by the
 * forecast graph.
 *
 * Flow:
 *   1. Extract low-tide events from the NOAA adapter result.
 *   2. Generate candidate windows centered on each low tide.
 *   3. For each candidate, resolve its timeline slots, apply hard rules,
 *      and — when hard rules pass — score the window.
 *   4. Sort passing windows by score (desc), weakest-slot score (desc),
 *      then start time (asc) for deterministic tie-breaking.
 *   5. Emit the best window, alternatives, blocking constraints, warnings,
 *      and timeline points.
 */

import { generateCandidateWindows, selectBestWindow, windowSlots } from './candidateWindows.js';
import type { CandidateWindow, ScoredWindow } from './candidateWindows.js';
import { evaluateHardRules } from './hardRules.js';
import { scoreSlot, scoreWindow } from './scorer.js';
import { deriveStatus, isPositiveStatus } from './status.js';
import { classifyWindDirection } from './windDirection.js';
import type { TideEvent } from '../providers/noaa/noaaTideAdapter.js';
import type {
  Normalized15MinuteTimeline,
  TimelineSlot,
  SuitabilityRuleset,
  SessionWindow,
  TimelinePoint,
  ScoreComponents,
} from '../generated/schema-types.js';
import type { RecommendationStatus } from './status.js';

// ─── Public types ──────────────────────────────────────────────────────────────

export interface WindowSelectorInput {
  timeline: Normalized15MinuteTimeline;
  ruleset: SuitabilityRuleset;
  /** All tide events for the day (HIGH and LOW). */
  tideEvents: TideEvent[];
  seawardBearingDegrees: number;
}

export interface WindowSelectorResult {
  /** Best-window status; NO_GO when no valid window exists. */
  status: RecommendationStatus;
  /** Best session window, or null when no window passes hard rules + scoring. */
  bestWindow: SessionWindow | null;
  /**
   * Runner-up windows that pass hard rules and have a positive status.
   * Ordered by the same ranking as bestWindow.
   */
  alternatives: SessionWindow[];
  /**
   * Hard-rule failures that produced the NO_GO status (empty when a valid
   * window exists).
   */
  blockingConstraints: string[];
  /** Non-blocking conditions worth surfacing to the user. */
  warnings: string[];
  /** One TimelinePoint per 15-minute slot for the forecast graph. */
  timelinePoints: TimelinePoint[];
}

// ─── Main selector ────────────────────────────────────────────────────────────

export function selectWindows(input: WindowSelectorInput): WindowSelectorResult {
  const { timeline, ruleset, tideEvents, seawardBearingDegrees } = input;

  // Build a slot lookup indexed by UTC ms
  const slotByMs = new Map<number, TimelineSlot>();
  for (const slot of timeline.slots) {
    slotByMs.set(new Date(slot.timeUtc).getTime(), slot);
  }

  // Determine horizon from the timeline
  const firstSlot = timeline.slots[0]!;
  const lastSlot = timeline.slots[timeline.slots.length - 1]!;
  const SLOT_MS = 15 * 60 * 1000;
  const horizonStart = new Date(firstSlot.timeUtc).getTime();
  const horizonEnd = new Date(lastSlot.timeUtc).getTime() + SLOT_MS;

  // Filter tide events to LOW type only and map to LowTideEvent shape
  const lowTides = tideEvents
    .filter((e) => e.type === 'LOW')
    .map((e) => ({ timeUtcMs: e.timeUtcMs, heightFeet: e.heightFeet }));

  // Generate candidate windows centered on each low tide
  const candidates = generateCandidateWindows(lowTides, horizonStart, horizonEnd);

  // Evaluate each candidate
  const thresholds = {
    goMinScore: ruleset.thresholds.goMinimumScore,
    marginalMinScore: ruleset.thresholds.marginalMinimumScore,
  };

  const scoredWindows: ScoredWindow[] = [];
  const allBlockingConstraints: string[] = [];

  for (const candidate of candidates) {
    const slotMs = windowSlots(candidate);
    const slots = slotMs.flatMap((ms) => {
      const slot = slotByMs.get(ms);
      return slot ? [slot] : [];
    });

    const lowTideUtcMs = candidate.lowTide.timeUtcMs;

    // Hard rules
    const hardResult = evaluateHardRules({
      windowSlots: slots,
      lowTideUtcMs,
      windowStartUtcMs: candidate.startUtcMs,
      windowEndUtcMs: candidate.endUtcMs,
      ruleset,
      seawardBearingDegrees,
    });

    if (!hardResult.passed) {
      for (const c of hardResult.blockingConstraints) {
        if (!allBlockingConstraints.includes(c)) {
          allBlockingConstraints.push(c);
        }
      }
      continue;
    }

    // Scoring
    const scoreResult = scoreWindow({
      windowSlots: slots,
      lowTideUtcMs,
      ruleset,
      seawardBearingDegrees,
    });

    scoredWindows.push({
      ...candidate,
      score: scoreResult.score,
      weakestSlotScore: scoreResult.weakestSlotScore,
    });
  }

  // Build timeline points (one per slot, before window selection)
  const timelinePoints = buildTimelinePoints(
    timeline.slots,
    ruleset,
    seawardBearingDegrees,
    thresholds,
  );

  if (scoredWindows.length === 0) {
    // Deduplicate blockers — collect unique constraint messages
    const uniqueBlockers = [...new Set(allBlockingConstraints)];
    return {
      status: 'NO_GO',
      bestWindow: null,
      alternatives: [],
      blockingConstraints: uniqueBlockers,
      warnings: [],
      timelinePoints,
    };
  }

  // Select best and alternatives using deterministic ranking
  const best = selectBestWindow(scoredWindows);
  const restSorted = [...scoredWindows]
    .filter((w) => w !== best)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.weakestSlotScore !== a.weakestSlotScore) return b.weakestSlotScore - a.weakestSlotScore;
      return a.startUtcMs - b.startUtcMs;
    });

  // Re-score the best window with full details for output
  const bestSlotMs = windowSlots(best);
  const bestSlots = bestSlotMs.flatMap((ms) => {
    const slot = slotByMs.get(ms);
    return slot ? [slot] : [];
  });
  const bestScoreResult = scoreWindow({
    windowSlots: bestSlots,
    lowTideUtcMs: best.lowTide.timeUtcMs,
    ruleset,
    seawardBearingDegrees,
  });

  const bestStatus = deriveStatus(
    true,
    Math.min(bestScoreResult.score, bestScoreResult.weakestSlotScore),
    thresholds,
  );

  const bestWindow = buildSessionWindow(
    best,
    bestSlots,
    bestScoreResult.score,
    bestScoreResult.weakestSlotScore,
    bestScoreResult.scoreComponents,
    bestStatus,
    ruleset,
    seawardBearingDegrees,
  );

  const alternativeWindows: SessionWindow[] = [];
  for (const w of restSorted) {
    const altSlotMs = windowSlots(w);
    const altSlots = altSlotMs.flatMap((ms) => {
      const slot = slotByMs.get(ms);
      return slot ? [slot] : [];
    });
    const altScoreResult = scoreWindow({
      windowSlots: altSlots,
      lowTideUtcMs: w.lowTide.timeUtcMs,
      ruleset,
      seawardBearingDegrees,
    });
    const altStatus = deriveStatus(
      true,
      Math.min(altScoreResult.score, altScoreResult.weakestSlotScore),
      thresholds,
    );
    if (isPositiveStatus(altStatus)) {
      alternativeWindows.push(
        buildSessionWindow(
          w,
          altSlots,
          altScoreResult.score,
          altScoreResult.weakestSlotScore,
          altScoreResult.scoreComponents,
          altStatus,
          ruleset,
          seawardBearingDegrees,
        ),
      );
    }
  }

  // Mark isInBestWindow on timeline points
  const bestWindowMs = new Set(bestSlotMs);
  const markedTimelinePoints = timelinePoints.map((pt) => {
    const ptMs = new Date(pt.timeUtc).getTime();
    return bestWindowMs.has(ptMs) ? { ...pt, isInBestWindow: true } : pt;
  });

  const overallStatus = isPositiveStatus(bestStatus) ? bestStatus : 'NO_GO';
  const warnings = buildWarnings(bestSlots);

  return {
    status: overallStatus,
    bestWindow: isPositiveStatus(bestStatus) ? bestWindow : null,
    alternatives: alternativeWindows,
    blockingConstraints: [],
    warnings,
    timelinePoints: markedTimelinePoints,
  };
}

// ─── Session window builder ───────────────────────────────────────────────────

function buildSessionWindow(
  candidate: ScoredWindow,
  slots: TimelineSlot[],
  score: number,
  weakestSlotScore: number,
  scoreComponents: ScoreComponents,
  status: RecommendationStatus,
  ruleset: SuitabilityRuleset,
  seawardBearingDegrees: number,
): SessionWindow {
  const reasons = buildReasons(slots, candidate, score, ruleset, seawardBearingDegrees);
  const warnings = buildWarnings(slots);

  return {
    startUtc: new Date(candidate.startUtcMs).toISOString(),
    endUtc: new Date(candidate.endUtcMs).toISOString(),
    status,
    score,
    weakestSlotScore,
    lowTideUtc: new Date(candidate.lowTide.timeUtcMs).toISOString(),
    reasons,
    ...(warnings.length > 0 && { warnings }),
    scoreComponents,
  };
}

// ─── Reasons builder ──────────────────────────────────────────────────────────

function buildReasons(
  slots: TimelineSlot[],
  candidate: CandidateWindow,
  score: number,
  ruleset: SuitabilityRuleset,
  seawardBearingDegrees: number,
): string[] {
  const reasons: string[] = [];

  // Wind speed summary
  const windSpeeds = slots.map((s) => s.windSpeedKnots).filter((v): v is number => v !== null);

  if (windSpeeds.length > 0) {
    const minKt = Math.min(...windSpeeds);
    const maxKt = Math.max(...windSpeeds);
    const KNOTS_TO_MPH = 1 / 0.868976;
    const minMph = Math.round(minKt * KNOTS_TO_MPH);
    const maxMph = Math.round(maxKt * KNOTS_TO_MPH);
    if (minMph === maxMph) {
      reasons.push(`Wind ${minMph} mph throughout the session`);
    } else {
      reasons.push(`Wind ${minMph}–${maxMph} mph during session`);
    }
  }

  // Wind direction summary
  const dirSlots = slots.filter((s) => s.windDirectionDegrees !== null);
  if (dirSlots.length > 0) {
    const classifications = dirSlots.map((s) =>
      classifyWindDirection(s.windDirectionDegrees!, seawardBearingDegrees),
    );
    const dominant = mostCommon(classifications);
    if (dominant === 'DIRECT_ONSHORE') {
      reasons.push('Direct onshore wind direction');
    } else if (dominant === 'SIDE_ONSHORE') {
      reasons.push('Side-onshore wind direction');
    } else if (dominant === 'CROSS_SHORE') {
      reasons.push('Cross-shore wind direction');
    }
  }

  // Tide
  const lowTideTime = new Date(candidate.lowTide.timeUtcMs);
  const lowTideHHMM = `${String(lowTideTime.getUTCHours()).padStart(2, '0')}:${String(lowTideTime.getUTCMinutes()).padStart(2, '0')} UTC`;
  reasons.push(
    `Low tide ${lowTideHHMM} within session (${candidate.lowTide.heightFeet.toFixed(1)} ft)`,
  );

  // Score context
  if (score >= ruleset.thresholds.goMinimumScore) {
    reasons.push(`Overall score ${score}/100 — conditions suitable for kiteboarding`);
  } else if (score >= ruleset.thresholds.marginalMinimumScore) {
    reasons.push(`Overall score ${score}/100 — marginal conditions`);
  }

  return reasons;
}

// ─── Warnings builder ─────────────────────────────────────────────────────────

function buildWarnings(slots: TimelineSlot[]): string[] {
  const warnings: string[] = [];

  const lowConfidence = slots.filter((s) => s.confidence != null && s.confidence < 0.7);
  if (lowConfidence.length > 0) {
    warnings.push(`Low forecast confidence in ${lowConfidence.length} of ${slots.length} slot(s)`);
  }

  const interpolated = slots.filter(
    (s) => (s.interpolatedFields?.length ?? 0) > 0 || s.dataSource === 'INTERPOLATED',
  );
  if (interpolated.length === slots.length && slots.length > 0) {
    warnings.push('All tide data is interpolated from NOAA hi-lo events');
  }

  return warnings;
}

// ─── Timeline points builder ──────────────────────────────────────────────────

function buildTimelinePoints(
  slots: readonly TimelineSlot[],
  ruleset: SuitabilityRuleset,
  seawardBearingDegrees: number,
  thresholds: { goMinScore: number; marginalMinScore: number },
): TimelinePoint[] {
  return slots.map((slot) => {
    const isMissing = slot.dataSource === 'MISSING';

    let score: number | null = null;
    let status: RecommendationStatus = 'UNKNOWN';

    if (!isMissing) {
      // Individual slot score (no low tide context for timeline points)
      const slotScore = scoreSlot(slot, null, ruleset, seawardBearingDegrees);
      score = slotScore.totalScore;
      status = deriveStatus(true, score, thresholds);
    }

    const classification =
      slot.windDirectionDegrees != null
        ? classifyWindDirection(slot.windDirectionDegrees, seawardBearingDegrees)
        : undefined;

    const point: TimelinePoint = {
      timeUtc: slot.timeUtc,
      status,
      score,
      ...(slot.windSpeedKnots !== undefined && { windSpeedKnots: slot.windSpeedKnots }),
      ...(slot.windDirectionDegrees !== undefined && {
        windDirectionDegrees: slot.windDirectionDegrees,
      }),
      ...(slot.gustSpeedKnots !== undefined && { gustSpeedKnots: slot.gustSpeedKnots }),
      ...(slot.tideHeightFeet !== undefined && { tideHeightFeet: slot.tideHeightFeet }),
      ...(slot.temperatureCelsius !== undefined && { temperatureCelsius: slot.temperatureCelsius }),
      ...(slot.probabilityOfPrecipitation !== undefined && {
        probabilityOfPrecipitation: slot.probabilityOfPrecipitation,
      }),
      ...(slot.isDaylight != null && { isDaylight: slot.isDaylight }),
      ...(slot.interpolatedFields !== undefined && { interpolatedFields: slot.interpolatedFields }),
      ...(slot.dataSource !== undefined && { dataSource: slot.dataSource }),
      ...(slot.confidence !== undefined && { confidence: slot.confidence }),
      ...(classification !== undefined && { windClassification: classification }),
    };

    return point;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mostCommon<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<T, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: T | undefined;
  let bestCount = 0;
  for (const [v, count] of counts) {
    if (count > bestCount) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}
