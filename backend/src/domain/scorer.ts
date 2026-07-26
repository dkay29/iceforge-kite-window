/**
 * Scoring and weakest-point weighting.
 *
 * Scores each 15-minute slot independently across six components, then
 * aggregates to a window score.  The weakest-point rule ensures that a
 * single poor slot cannot be hidden by a strong average.
 *
 * Algorithm version: 1
 *
 * Component scores are in [0, 100].  The window score is the weighted
 * average of per-slot total scores.  The status threshold check uses
 * min(windowScore, weakestSlotScore) so that a window with a high average
 * but one unsafe slot cannot achieve GO or MARGINAL status.
 */

import { classifyWindDirection } from './windDirection.js';
import type {
  TimelineSlot,
  SuitabilityRuleset,
  ScoreComponents,
  RecommendationStatus,
} from '../generated/schema-types.js';

// mph ↔ knots conversion
const KNOTS_TO_MPH = 1 / 0.868976;

/** Algorithm version — increment whenever scoring logic changes. */
export const SCORER_ALGORITHM_VERSION = 1;

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SlotScore {
  /** Weighted total score for this slot (0–100, rounded). */
  totalScore: number;
  /** Per-component scores (each 0–100). */
  components: ScoreComponents;
}

export interface WindowScoreInput {
  windowSlots: TimelineSlot[];
  /** UTC ms of the low-tide event, or null when not available. */
  lowTideUtcMs: number | null;
  ruleset: SuitabilityRuleset;
  seawardBearingDegrees: number;
}

export interface WindowScoreResult {
  /**
   * Weighted average of per-slot total scores (0–100, rounded).
   * Used for ranking windows against each other.
   */
  score: number;
  /**
   * Minimum per-slot total score across the window (0–100, rounded).
   * Reflects the worst single slot; used by status determination to
   * prevent good averages from masking one weak interval.
   */
  weakestSlotScore: number;
  /**
   * Per-component averages across the window (each 0–100, rounded).
   * For display/debug; does not affect status determination.
   */
  scoreComponents: ScoreComponents;
  /** Per-slot scores in the same order as windowSlots. */
  slotScores: SlotScore[];
}

// ─── Status determination ─────────────────────────────────────────────────────

/**
 * Determine recommendation status from average and weakest-slot scores.
 *
 * Both the average score AND the weakest slot must reach the threshold.
 * A window with a high average but one failing slot cannot be GO or MARGINAL.
 */
export function determineStatus(
  score: number,
  weakestSlotScore: number,
  thresholds: SuitabilityRuleset['thresholds'],
): RecommendationStatus {
  const effective = Math.min(score, weakestSlotScore);
  if (effective >= thresholds.goMinimumScore) return 'GO';
  if (effective >= thresholds.marginalMinimumScore) return 'MARGINAL';
  return 'NO_GO';
}

// ─── Window scorer ────────────────────────────────────────────────────────────

export function scoreWindow(input: WindowScoreInput): WindowScoreResult {
  const { windowSlots, lowTideUtcMs, ruleset, seawardBearingDegrees } = input;

  if (windowSlots.length === 0) {
    const zero = zeroComponents();
    return { score: 0, weakestSlotScore: 0, scoreComponents: zero, slotScores: [] };
  }

  const slotScores = windowSlots.map((slot) =>
    scoreSlot(slot, lowTideUtcMs, ruleset, seawardBearingDegrees),
  );

  const weakestSlotScore = Math.min(...slotScores.map((s) => s.totalScore));

  const componentKeys: (keyof ScoreComponents)[] = [
    'windSpeed',
    'windDirection',
    'tideAlignment',
    'gustStability',
    'weather',
    'confidence',
  ];

  const avgComponents = Object.fromEntries(
    componentKeys.map((key) => [key, roundScore(mean(slotScores.map((s) => s.components[key])))]),
  ) as unknown as ScoreComponents;

  const weights = resolveWeights(ruleset);
  const score = computeWeightedScore(avgComponents, weights);

  return { score, weakestSlotScore, scoreComponents: avgComponents, slotScores };
}

// ─── Slot scorer ──────────────────────────────────────────────────────────────

export function scoreSlot(
  slot: TimelineSlot,
  lowTideUtcMs: number | null,
  ruleset: SuitabilityRuleset,
  seawardBearingDegrees: number,
): SlotScore {
  const slotMs = new Date(slot.timeUtc).getTime();

  const components: ScoreComponents = {
    windSpeed: scoreWindSpeed(slot, ruleset),
    windDirection: scoreWindDirection(slot, seawardBearingDegrees),
    tideAlignment: scoreTideAlignment(slotMs, lowTideUtcMs, ruleset),
    gustStability: scoreGustStability(slot, ruleset),
    weather: scoreWeather(slot),
    confidence: scoreConfidence(slot),
  };

  const weights = resolveWeights(ruleset);
  const totalScore = computeWeightedScore(components, weights);

  return { totalScore, components };
}

// ─── Component scorers ────────────────────────────────────────────────────────

/**
 * Wind speed score.
 *
 * 0 below minimumUsableMph.
 * Scales 0→100 from minimumUsableMph to preferredMinimumMph.
 * 100 across the preferred range.
 * Scales 100→0 from preferredMaximumMph to absoluteMaximumMph.
 * 0 above absoluteMaximumMph.
 */
function scoreWindSpeed(slot: TimelineSlot, ruleset: SuitabilityRuleset): number {
  if (slot.windSpeedKnots == null) return 0;

  const speedMph = slot.windSpeedKnots * KNOTS_TO_MPH;
  const { minimumUsableMph, preferredMinimumMph, preferredMaximumMph, absoluteMaximumMph } =
    ruleset.wind;

  if (speedMph < minimumUsableMph) return 0;

  if (speedMph <= preferredMinimumMph) {
    const range = preferredMinimumMph - minimumUsableMph;
    if (range <= 0) return 100;
    return roundScore(lerp(0, 100, (speedMph - minimumUsableMph) / range));
  }

  if (speedMph <= preferredMaximumMph) return 100;

  if (speedMph <= absoluteMaximumMph) {
    const range = absoluteMaximumMph - preferredMaximumMph;
    if (range <= 0) return 0;
    return roundScore(lerp(100, 0, (speedMph - preferredMaximumMph) / range));
  }

  return 0;
}

/**
 * Wind direction score based on classification relative to seaward bearing.
 *
 * DIRECT_ONSHORE  → 100
 * SIDE_ONSHORE    →  75
 * CROSS_SHORE     →  40
 * SIDE_OFFSHORE   →  15
 * OFFSHORE        →   0
 *
 * Null direction → 50 (uncertain).
 */
function scoreWindDirection(slot: TimelineSlot, seawardBearingDegrees: number): number {
  if (slot.windDirectionDegrees == null) return 50;

  const classification = classifyWindDirection(slot.windDirectionDegrees, seawardBearingDegrees);
  switch (classification) {
    case 'DIRECT_ONSHORE':
      return 100;
    case 'SIDE_ONSHORE':
      return 75;
    case 'CROSS_SHORE':
      return 40;
    case 'SIDE_OFFSHORE':
      return 15;
    case 'OFFSHORE':
      return 0;
  }
}

/**
 * Tide alignment score.
 *
 * Scores how close the slot time is to the low-tide event.  A slot at
 * exactly the low tide scores 100; a slot one half-session-duration away
 * scores 0.  Null lowTideUtcMs → 50 (uncertain).
 */
function scoreTideAlignment(
  slotMs: number,
  lowTideUtcMs: number | null,
  ruleset: SuitabilityRuleset,
): number {
  if (lowTideUtcMs === null) return 50;

  const halfDurationMs = (ruleset.session.requiredDurationMinutes / 2) * 60_000;
  const distanceMs = Math.abs(slotMs - lowTideUtcMs);

  return roundScore(Math.max(0, 100 - (distanceMs / halfDurationMs) * 100));
}

/**
 * Gust stability score based on gust spread (gust minus sustained wind).
 *
 * 0 spread → 100.  At maximumGustSpreadMph → 0.  Linear in between.
 * Either component null → 50 (uncertain).
 */
function scoreGustStability(slot: TimelineSlot, ruleset: SuitabilityRuleset): number {
  if (slot.gustSpeedKnots == null || slot.windSpeedKnots == null) return 50;

  const spreadKnots = Math.max(0, slot.gustSpeedKnots - slot.windSpeedKnots);
  const maxSpreadKnots = ruleset.wind.maximumGustSpreadMph / KNOTS_TO_MPH;

  if (maxSpreadKnots <= 0) return spreadKnots === 0 ? 100 : 0;

  return roundScore(Math.max(0, 100 - (spreadKnots / maxSpreadKnots) * 100));
}

/**
 * Weather score based on probability of precipitation.
 *
 * 0% precipitation → 100.  100% precipitation → 0.  Null → 50.
 */
function scoreWeather(slot: TimelineSlot): number {
  if (slot.probabilityOfPrecipitation == null) return 50;
  return roundScore(100 - slot.probabilityOfPrecipitation);
}

/**
 * Confidence score.
 *
 * Slot confidence 1.0 → 100.  0.0 → 0.  Null → 50.
 */
function scoreConfidence(slot: TimelineSlot): number {
  if (slot.confidence == null) return 50;
  return roundScore(slot.confidence * 100);
}

// ─── Weight resolution ────────────────────────────────────────────────────────

interface ScoringWeights {
  windSpeed: number;
  windDirection: number;
  tideAlignment: number;
  gustStability: number;
  weather: number;
  confidence: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  windSpeed: 30,
  windDirection: 25,
  tideAlignment: 20,
  gustStability: 15,
  weather: 5,
  confidence: 5,
};

function resolveWeights(ruleset: SuitabilityRuleset): ScoringWeights {
  // scoring is typed as { [k: string]: any } in the generated schema types
  const raw = ruleset.scoring as Record<string, unknown>;
  const w = (raw['weights'] ?? {}) as Partial<Record<string, number>>;

  return {
    windSpeed: w['windSpeed'] ?? DEFAULT_WEIGHTS.windSpeed,
    windDirection: w['windDirection'] ?? DEFAULT_WEIGHTS.windDirection,
    tideAlignment: w['tideAlignment'] ?? DEFAULT_WEIGHTS.tideAlignment,
    gustStability: w['gustStability'] ?? DEFAULT_WEIGHTS.gustStability,
    weather: w['weather'] ?? DEFAULT_WEIGHTS.weather,
    confidence: w['confidence'] ?? DEFAULT_WEIGHTS.confidence,
  };
}

function computeWeightedScore(components: ScoreComponents, weights: ScoringWeights): number {
  const totalWeight =
    weights.windSpeed +
    weights.windDirection +
    weights.tideAlignment +
    weights.gustStability +
    weights.weather +
    weights.confidence;

  if (totalWeight === 0) return 0;

  const weighted =
    components.windSpeed * weights.windSpeed +
    components.windDirection * weights.windDirection +
    components.tideAlignment * weights.tideAlignment +
    components.gustStability * weights.gustStability +
    components.weather * weights.weather +
    components.confidence * weights.confidence;

  return roundScore(weighted / totalWeight);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function zeroComponents(): ScoreComponents {
  return {
    windSpeed: 0,
    windDirection: 0,
    tideAlignment: 0,
    gustStability: 0,
    weather: 0,
    confidence: 0,
  };
}
