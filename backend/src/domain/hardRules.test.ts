import { describe, expect, it } from 'vitest';
import { evaluateHardRules } from './hardRules.js';
import type { HardRuleInput } from './hardRules.js';
import type { TimelineSlot, SuitabilityRuleset } from '../generated/schema-types.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeSlot(overrides: Partial<TimelineSlot> = {}): TimelineSlot {
  return {
    timeUtc: '2026-07-26T10:00:00.000Z',
    windSpeedKnots: 13, // ~15 mph, within preferred range
    windDirectionDegrees: 200, // SSW → DIRECT_ONSHORE for seaward bearing 195°
    gustSpeedKnots: 18, // ~21 mph, within gust limit
    tideHeightFeet: 1.0,
    temperatureCelsius: 23,
    probabilityOfPrecipitation: 5,
    probabilityOfThunder: 0,
    skyCoverPercent: 20,
    isDaylight: true,
    dataSource: 'FORECAST',
    interpolatedFields: ['tideHeightFeet'],
    confidence: 0.9,
    ...overrides,
  };
}

function makeSlots(count = 12, overrides: Partial<TimelineSlot> = {}): TimelineSlot[] {
  return Array.from({ length: count }, (_, i) =>
    makeSlot({
      timeUtc: `2026-07-26T${String(10 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00.000Z`,
      ...overrides,
    }),
  );
}

const RULESET: SuitabilityRuleset = {
  schemaVersion: '1.0',
  rulesetId: 'west-dennis-beach-ma-default',
  version: 1,
  session: {
    requiredDurationMinutes: 180,
    evaluationIntervalMinutes: 15,
    lowTideRequirement: 'MUST_BE_INSIDE',
    daylightRequired: true,
  },
  wind: {
    minimumUsableMph: 8,
    preferredMinimumMph: 12,
    preferredMaximumMph: 25,
    absoluteMaximumMph: 35,
    maximumGustMph: 40,
    maximumGustSpreadMph: 15,
    acceptedClassifications: ['DIRECT_ONSHORE', 'SIDE_ONSHORE'],
  },
  scoring: { weights: {} },
  thresholds: { goMinimumScore: 70, marginalMinimumScore: 40 },
};

// West Dennis Beach seaward bearing
const SEAWARD_BEARING = 195;

// A low tide at 10:45 UTC (within window 10:00–13:00)
const LOW_TIDE_UTC_MS = Date.UTC(2026, 6, 26, 10, 45, 0);
const WINDOW_START_MS = Date.UTC(2026, 6, 26, 10, 0, 0);
const WINDOW_END_MS = Date.UTC(2026, 6, 26, 13, 0, 0);

function makeInput(overrides: Partial<HardRuleInput> = {}): HardRuleInput {
  return {
    windowSlots: makeSlots(),
    lowTideUtcMs: LOW_TIDE_UTC_MS,
    windowStartUtcMs: WINDOW_START_MS,
    windowEndUtcMs: WINDOW_END_MS,
    ruleset: RULESET,
    seawardBearingDegrees: SEAWARD_BEARING,
    ...overrides,
  };
}

// ─── All rules pass ───────────────────────────────────────────────────────────

describe('evaluateHardRules — nominal (all pass)', () => {
  it('returns passed=true when no rules fail', () => {
    const result = evaluateHardRules(makeInput());
    expect(result.passed).toBe(true);
  });

  it('returns empty blockingConstraints when all rules pass', () => {
    const result = evaluateHardRules(makeInput());
    expect(result.blockingConstraints).toHaveLength(0);
  });
});

// ─── Insufficient data ────────────────────────────────────────────────────────

describe('checkInsufficientDataRule', () => {
  it('fails when all slots have no wind or tide data', () => {
    const slots = makeSlots(12, { windSpeedKnots: null, tideHeightFeet: null });
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /insufficient data/i.test(c))).toBe(true);
  });

  it('fails when ≥50% of slots have no data', () => {
    const slots = [
      ...makeSlots(6, { windSpeedKnots: null, tideHeightFeet: null }),
      ...makeSlots(6),
    ];
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /insufficient data/i.test(c))).toBe(true);
  });

  it('passes when <50% of slots have no data', () => {
    const slots = [
      ...makeSlots(5, { windSpeedKnots: null, tideHeightFeet: null }),
      ...makeSlots(7),
    ];
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    // The data-sufficiency rule should pass (5/12 < 0.5)
    expect(result.blockingConstraints.some((c) => /insufficient data/i.test(c))).toBe(false);
  });

  it('fails immediately when there are no slots', () => {
    const result = evaluateHardRules(makeInput({ windowSlots: [] }));
    expect(result.passed).toBe(false);
  });
});

// ─── Daylight ─────────────────────────────────────────────────────────────────

describe('checkDaylightRule', () => {
  it('fails when any slot is not in daylight and daylightRequired=true', () => {
    const slots = makeSlots(12);
    slots[3]!.isDaylight = false;
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /daylight/i.test(c))).toBe(true);
  });

  it('passes when daylightRequired=false even if slots are dark', () => {
    const slots = makeSlots(12, { isDaylight: false });
    const ruleset = { ...RULESET, session: { ...RULESET.session, daylightRequired: false } };
    const result = evaluateHardRules(makeInput({ windowSlots: slots, ruleset }));
    expect(result.blockingConstraints.some((c) => /daylight/i.test(c))).toBe(false);
  });

  it('passes when all slots are in daylight', () => {
    const result = evaluateHardRules(makeInput());
    expect(result.blockingConstraints.some((c) => /daylight/i.test(c))).toBe(false);
  });
});

// ─── Low-tide requirement ─────────────────────────────────────────────────────

describe('checkLowTideRule', () => {
  it('fails when low tide is before the window start', () => {
    const lowTide = WINDOW_START_MS - 1;
    const result = evaluateHardRules(makeInput({ lowTideUtcMs: lowTide }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /low-tide/i.test(c))).toBe(true);
  });

  it('fails when low tide is at window end (exclusive)', () => {
    const result = evaluateHardRules(makeInput({ lowTideUtcMs: WINDOW_END_MS }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /low-tide/i.test(c))).toBe(true);
  });

  it('passes when low tide is at window start (inclusive)', () => {
    const result = evaluateHardRules(makeInput({ lowTideUtcMs: WINDOW_START_MS }));
    expect(result.blockingConstraints.some((c) => /low-tide/i.test(c))).toBe(false);
  });

  it('fails when lowTideUtcMs is null', () => {
    const result = evaluateHardRules(makeInput({ lowTideUtcMs: null }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /low-tide/i.test(c))).toBe(true);
  });

  it('passes when lowTideRequirement is OPTIONAL regardless of tide position', () => {
    const ruleset = {
      ...RULESET,
      session: { ...RULESET.session, lowTideRequirement: 'OPTIONAL' as const },
    };
    const result = evaluateHardRules(makeInput({ lowTideUtcMs: null, ruleset }));
    expect(result.blockingConstraints.some((c) => /low-tide/i.test(c))).toBe(false);
  });
});

// ─── Wind direction ───────────────────────────────────────────────────────────

describe('checkWindDirectionRule', () => {
  it('fails when any slot has an offshore wind direction', () => {
    // North (0°) is OFFSHORE for seaward bearing 195°
    const slots = makeSlots(12);
    slots[5]!.windDirectionDegrees = 0;
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /wind direction/i.test(c))).toBe(true);
  });

  it('passes when all slots have DIRECT_ONSHORE direction', () => {
    // 200° SSW is DIRECT_ONSHORE for seaward bearing 195°
    const result = evaluateHardRules(makeInput());
    expect(result.blockingConstraints.some((c) => /wind direction/i.test(c))).toBe(false);
  });

  it('passes when all slots have SIDE_ONSHORE direction', () => {
    const slots = makeSlots(12, { windDirectionDegrees: 150 }); // SE → SIDE_ONSHORE
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.blockingConstraints.some((c) => /wind direction/i.test(c))).toBe(false);
  });

  it('skips slots with null wind direction (missing data not a hard failure)', () => {
    const slots = makeSlots(12, { windDirectionDegrees: null });
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.blockingConstraints.some((c) => /wind direction/i.test(c))).toBe(false);
  });

  it('wraps correctly around 0°/360° boundary', () => {
    // NNE (30°) with seaward bearing 195° → φ = 165° → OFFSHORE
    const slots = makeSlots(12, { windDirectionDegrees: 30 });
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.blockingConstraints.some((c) => /wind direction/i.test(c))).toBe(true);
  });
});

// ─── Absolute wind speed ──────────────────────────────────────────────────────

describe('checkAbsoluteWindSpeedRule', () => {
  it('fails when any slot exceeds absoluteMaximumMph (35 mph ≈ 30.4 kt)', () => {
    const slots = makeSlots(12);
    // 35 mph = ~30.4 kt; 31 kt is over the limit
    slots[2]!.windSpeedKnots = 31;
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /absolute maximum/i.test(c))).toBe(true);
  });

  it('passes when all slots are at or below the limit', () => {
    const result = evaluateHardRules(makeInput());
    expect(result.blockingConstraints.some((c) => /absolute maximum/i.test(c))).toBe(false);
  });

  it('passes when wind speed is null (missing data)', () => {
    const slots = makeSlots(12, { windSpeedKnots: null });
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.blockingConstraints.some((c) => /absolute maximum/i.test(c))).toBe(false);
  });
});

// ─── Gust rule ────────────────────────────────────────────────────────────────

describe('checkGustRule', () => {
  it('fails when any slot gust exceeds maximumGustMph (40 mph ≈ 34.8 kt)', () => {
    const slots = makeSlots(12);
    slots[1]!.gustSpeedKnots = 35; // > 34.8 kt
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /gust/i.test(c))).toBe(true);
  });

  it('passes when all gusts are within the limit', () => {
    const result = evaluateHardRules(makeInput());
    expect(result.blockingConstraints.some((c) => /gust/i.test(c))).toBe(false);
  });
});

// ─── Thunder ──────────────────────────────────────────────────────────────────

describe('checkThunderRule', () => {
  it('fails when any slot has thunder probability > 30%', () => {
    const slots = makeSlots(12);
    slots[7]!.probabilityOfThunder = 31;
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.passed).toBe(false);
    expect(result.blockingConstraints.some((c) => /thunder/i.test(c))).toBe(true);
  });

  it('passes when thunder probability is exactly 30% (not greater)', () => {
    const slots = makeSlots(12, { probabilityOfThunder: 30 });
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.blockingConstraints.some((c) => /thunder/i.test(c))).toBe(false);
  });

  it('passes when thunder probability is null', () => {
    const slots = makeSlots(12, { probabilityOfThunder: null });
    const result = evaluateHardRules(makeInput({ windowSlots: slots }));
    expect(result.blockingConstraints.some((c) => /thunder/i.test(c))).toBe(false);
  });
});

// ─── Multiple failures ────────────────────────────────────────────────────────

describe('evaluateHardRules — multiple failures reported', () => {
  it('collects all blocking constraints rather than stopping at the first', () => {
    const slots = makeSlots(12, {
      isDaylight: false, // daylight failure
      windDirectionDegrees: 0, // direction failure
      probabilityOfThunder: 50, // thunder failure
    });
    const result = evaluateHardRules(makeInput({ windowSlots: slots, lowTideUtcMs: null }));
    expect(result.passed).toBe(false);
    // Expect at least 4 different constraint types
    expect(result.blockingConstraints.length).toBeGreaterThanOrEqual(4);
  });
});
