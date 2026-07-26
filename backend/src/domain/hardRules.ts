/**
 * Hard safety constraint evaluation.
 *
 * Hard rules are binary pass/fail checks applied independently to each slot
 * in a candidate window.  A single failing slot fails the entire window — one
 * unsafe interval cannot be hidden by a good average.
 *
 * Rules implement the domain constraints described in CLAUDE.md:
 *   - Offshore wind direction
 *   - Daylight requirement
 *   - Low-tide window requirement
 *   - Absolute wind and gust limits
 *   - Thunder / hazard threshold
 *   - Insufficient data
 */

import { classifyWindDirection } from './windDirection.js';
import type { TimelineSlot } from '../generated/schema-types.js';
import type { SuitabilityRuleset } from '../generated/schema-types.js';

// mph → knots conversion factor
const MPH_TO_KNOTS = 0.868976;

// Thunder is a hard-stop hazard above this threshold.
const THUNDER_HARD_STOP_PERCENT = 30;

// A window is considered "data-insufficient" when this fraction of its slots
// are tagged MISSING for both wind and tide.
const MISSING_SLOT_FRACTION_THRESHOLD = 0.5;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface HardRuleInput {
  /** Slots within the candidate window (in order). */
  windowSlots: TimelineSlot[];
  /** UTC ms of the low-tide event inside or near this window, or null. */
  lowTideUtcMs: number | null;
  /** Inclusive window start in UTC ms. */
  windowStartUtcMs: number;
  /** Exclusive window end in UTC ms. */
  windowEndUtcMs: number;
  /** Validated ruleset for this spot. */
  ruleset: SuitabilityRuleset;
  /** Shore seaward bearing in degrees (from spot config). */
  seawardBearingDegrees: number;
}

export interface HardRuleResult {
  passed: boolean;
  /** Human-readable explanations for every constraint that failed. */
  blockingConstraints: string[];
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

export function evaluateHardRules(input: HardRuleInput): HardRuleResult {
  const constraints: string[] = [];

  // Run each rule; collect all failures (don't short-circuit).
  for (const rule of ALL_RULES) {
    const result = rule(input);
    if (!result.passed) {
      constraints.push(...result.blockingConstraints);
    }
  }

  return { passed: constraints.length === 0, blockingConstraints: constraints };
}

// ─── Individual rules ─────────────────────────────────────────────────────────

type Rule = (input: HardRuleInput) => HardRuleResult;

const ALL_RULES: Rule[] = [
  checkInsufficientDataRule,
  checkDaylightRule,
  checkLowTideRule,
  checkWindDirectionRule,
  checkAbsoluteWindSpeedRule,
  checkGustRule,
  checkThunderRule,
];

/**
 * Reject when too many slots have no meaningful data.
 * A slot is considered missing when both windSpeedKnots and tideHeightFeet are null.
 */
function checkInsufficientDataRule({ windowSlots }: HardRuleInput): HardRuleResult {
  if (windowSlots.length === 0) {
    return {
      passed: false,
      blockingConstraints: ['No data: window contains no slots'],
    };
  }
  const missingCount = windowSlots.filter(
    (s) => s.windSpeedKnots === null && s.tideHeightFeet === null,
  ).length;
  const fraction = missingCount / windowSlots.length;
  if (fraction >= MISSING_SLOT_FRACTION_THRESHOLD) {
    return {
      passed: false,
      blockingConstraints: [
        `Insufficient data: ${missingCount}/${windowSlots.length} slots have no wind or tide data`,
      ],
    };
  }
  return { passed: true, blockingConstraints: [] };
}

/**
 * Reject when daylight is required and any slot falls outside civil daylight.
 */
function checkDaylightRule({ windowSlots, ruleset }: HardRuleInput): HardRuleResult {
  if (!ruleset.session.daylightRequired) return { passed: true, blockingConstraints: [] };

  const darkSlots = windowSlots.filter((s) => s.isDaylight === false);
  if (darkSlots.length > 0) {
    return {
      passed: false,
      blockingConstraints: [
        `Daylight required: ${darkSlots.length} slot(s) fall outside civil daylight hours`,
      ],
    };
  }
  return { passed: true, blockingConstraints: [] };
}

/**
 * Reject when the low-tide requirement is MUST_BE_INSIDE and no low tide
 * falls within the half-open window [start, end).
 */
function checkLowTideRule({
  lowTideUtcMs,
  windowStartUtcMs,
  windowEndUtcMs,
  ruleset,
}: HardRuleInput): HardRuleResult {
  if (ruleset.session.lowTideRequirement === 'OPTIONAL') {
    return { passed: true, blockingConstraints: [] };
  }

  if (lowTideUtcMs === null) {
    return {
      passed: false,
      blockingConstraints: ['Low-tide requirement: no low tide provided for this window'],
    };
  }

  const insideWindow = lowTideUtcMs >= windowStartUtcMs && lowTideUtcMs < windowEndUtcMs;

  if (!insideWindow) {
    return {
      passed: false,
      blockingConstraints: [
        `Low-tide requirement (${ruleset.session.lowTideRequirement}): low tide at ` +
          `${new Date(lowTideUtcMs).toISOString()} is outside the window`,
      ],
    };
  }
  return { passed: true, blockingConstraints: [] };
}

/**
 * Reject when any slot with a known wind direction is in an unaccepted classification.
 */
function checkWindDirectionRule({
  windowSlots,
  ruleset,
  seawardBearingDegrees,
}: HardRuleInput): HardRuleResult {
  // Cast to Set<string> because the schema type only enumerates 3 of the 5 classifications.
  const accepted = new Set<string>(ruleset.wind.acceptedClassifications);
  const badSlots: string[] = [];

  for (const slot of windowSlots) {
    if (slot.windDirectionDegrees == null) continue; // missing data: not a hard failure here

    const classification = classifyWindDirection(slot.windDirectionDegrees, seawardBearingDegrees);
    if (!accepted.has(classification)) {
      badSlots.push(
        `${slot.timeUtc}: ${classification} (${Math.round(slot.windDirectionDegrees)}°)`,
      );
    }
  }

  if (badSlots.length > 0) {
    return {
      passed: false,
      blockingConstraints: [
        `Wind direction not accepted in ${badSlots.length} slot(s): ${badSlots.slice(0, 3).join(', ')}` +
          (badSlots.length > 3 ? ` … (${badSlots.length - 3} more)` : ''),
      ],
    };
  }
  return { passed: true, blockingConstraints: [] };
}

/**
 * Reject when any slot exceeds the absolute maximum wind speed.
 */
function checkAbsoluteWindSpeedRule({ windowSlots, ruleset }: HardRuleInput): HardRuleResult {
  const maxKnots = ruleset.wind.absoluteMaximumMph * MPH_TO_KNOTS;
  const overLimit = windowSlots.filter(
    (s) => s.windSpeedKnots != null && s.windSpeedKnots > maxKnots,
  );

  if (overLimit.length > 0) {
    const worst = Math.max(...overLimit.map((s) => s.windSpeedKnots ?? 0));
    return {
      passed: false,
      blockingConstraints: [
        `Wind speed exceeds absolute maximum (${ruleset.wind.absoluteMaximumMph} mph): ` +
          `${overLimit.length} slot(s), peak ${worst.toFixed(1)} kt`,
      ],
    };
  }
  return { passed: true, blockingConstraints: [] };
}

/**
 * Reject when any slot's gust exceeds the maximum gust speed.
 */
function checkGustRule({ windowSlots, ruleset }: HardRuleInput): HardRuleResult {
  const maxGustKnots = ruleset.wind.maximumGustMph * MPH_TO_KNOTS;
  const overLimit = windowSlots.filter(
    (s) => s.gustSpeedKnots != null && s.gustSpeedKnots > maxGustKnots,
  );

  if (overLimit.length > 0) {
    const worst = Math.max(...overLimit.map((s) => s.gustSpeedKnots ?? 0));
    return {
      passed: false,
      blockingConstraints: [
        `Gust speed exceeds maximum (${ruleset.wind.maximumGustMph} mph): ` +
          `${overLimit.length} slot(s), peak ${worst.toFixed(1)} kt`,
      ],
    };
  }
  return { passed: true, blockingConstraints: [] };
}

/**
 * Reject when any slot has a thunder probability above the hard-stop threshold.
 */
function checkThunderRule({ windowSlots }: HardRuleInput): HardRuleResult {
  const dangerousSlots = windowSlots.filter(
    (s) => s.probabilityOfThunder != null && s.probabilityOfThunder > THUNDER_HARD_STOP_PERCENT,
  );

  if (dangerousSlots.length > 0) {
    const peak = Math.max(...dangerousSlots.map((s) => s.probabilityOfThunder ?? 0));
    return {
      passed: false,
      blockingConstraints: [
        `Thunder probability exceeds safe threshold (${THUNDER_HARD_STOP_PERCENT}%): ` +
          `${dangerousSlots.length} slot(s), peak ${peak}%`,
      ],
    };
  }
  return { passed: true, blockingConstraints: [] };
}
