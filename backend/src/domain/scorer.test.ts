import { describe, expect, it } from 'vitest';
import { scoreSlot, scoreWindow, determineStatus, SCORER_ALGORITHM_VERSION } from './scorer.js';
import type { WindowScoreInput } from './scorer.js';
import type { TimelineSlot, SuitabilityRuleset } from '../generated/schema-types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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
  scoring: {
    weights: {
      windSpeed: 30,
      windDirection: 25,
      tideAlignment: 20,
      gustStability: 15,
      weather: 5,
      confidence: 5,
    },
  },
  thresholds: { goMinimumScore: 70, marginalMinimumScore: 40 },
};

// West Dennis Beach seaward bearing
const SEAWARD_BEARING = 195;

// Low tide at 10:45 UTC
const LOW_TIDE_UTC_MS = Date.UTC(2026, 6, 26, 10, 45, 0);

function makeSlot(overrides: Partial<TimelineSlot> = {}): TimelineSlot {
  return {
    timeUtc: '2026-07-26T10:45:00.000Z', // at the low tide time
    windSpeedKnots: 17.4, // ~20 mph, solidly in preferred range [12, 25]
    windDirectionDegrees: 200, // DIRECT_ONSHORE for seaward bearing 195°
    gustSpeedKnots: 19.1, // ~22 mph, small spread
    tideHeightFeet: 0.5,
    temperatureCelsius: 24,
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

function makeInput(overrides: Partial<WindowScoreInput> = {}): WindowScoreInput {
  return {
    windowSlots: makeSlots(),
    lowTideUtcMs: LOW_TIDE_UTC_MS,
    ruleset: RULESET,
    seawardBearingDegrees: SEAWARD_BEARING,
    ...overrides,
  };
}

// ─── Algorithm version ────────────────────────────────────────────────────────

describe('SCORER_ALGORITHM_VERSION', () => {
  it('is a positive integer', () => {
    expect(SCORER_ALGORITHM_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(SCORER_ALGORITHM_VERSION)).toBe(true);
  });
});

// ─── scoreSlot — windSpeed component ─────────────────────────────────────────

describe('scoreSlot — windSpeed', () => {
  it('returns 0 when windSpeedKnots is null', () => {
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: null }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windSpeed).toBe(0);
  });

  it('returns 0 below minimumUsableMph (8 mph ≈ 6.95 kt)', () => {
    // 7 mph = 7 * 0.869 ≈ 6.08 kt → below 8 mph
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: 6 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windSpeed).toBe(0);
  });

  it('returns 100 within preferred range [12, 25] mph', () => {
    // 20 mph = 17.38 kt
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: 17.38 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windSpeed).toBe(100);
  });

  it('returns a partial score between minimumUsable and preferredMin', () => {
    // 10 mph (midpoint of 8–12) = 8.69 kt → ~50% through the ramp
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: 8.69 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windSpeed).toBeGreaterThan(0);
    expect(result.components.windSpeed).toBeLessThan(100);
  });

  it('degrades above preferredMaximumMph toward absoluteMaximumMph', () => {
    // 30 mph (midpoint of 25–35) → ~50 score
    const knotsAt30mph = 30 * 0.868976;
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: knotsAt30mph }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windSpeed).toBeGreaterThan(0);
    expect(result.components.windSpeed).toBeLessThan(100);
  });

  it('returns 0 at exactly absoluteMaximumMph (35 mph ≈ 30.41 kt)', () => {
    const knotsAt35mph = 35 * 0.868976;
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: knotsAt35mph }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windSpeed).toBe(0);
  });

  it('returns 100 at preferredMinimumMph (12 mph ≈ 10.43 kt)', () => {
    const knotsAt12mph = 12 * 0.868976;
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: knotsAt12mph }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windSpeed).toBe(100);
  });
});

// ─── scoreSlot — windDirection component ─────────────────────────────────────

describe('scoreSlot — windDirection', () => {
  it('returns 100 for DIRECT_ONSHORE (φ ≤ 30°)', () => {
    // 195° = exactly seaward bearing → DIRECT_ONSHORE
    const result = scoreSlot(
      makeSlot({ windDirectionDegrees: 195 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windDirection).toBe(100);
  });

  it('returns 75 for SIDE_ONSHORE (30° < φ ≤ 75°)', () => {
    // 150° → φ = |150 - 195| = 45° → SIDE_ONSHORE
    const result = scoreSlot(
      makeSlot({ windDirectionDegrees: 150 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windDirection).toBe(75);
  });

  it('returns 40 for CROSS_SHORE (75° < φ ≤ 90°)', () => {
    // 105° → φ = |105 - 195| = 90° → CROSS_SHORE
    const result = scoreSlot(
      makeSlot({ windDirectionDegrees: 105 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windDirection).toBe(40);
  });

  it('returns 15 for SIDE_OFFSHORE (90° < φ ≤ 135°)', () => {
    // 75° → φ = |75 - 195| = 120° → SIDE_OFFSHORE
    const result = scoreSlot(
      makeSlot({ windDirectionDegrees: 75 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windDirection).toBe(15);
  });

  it('returns 0 for OFFSHORE (φ > 135°)', () => {
    // 0° → φ = |0 - 195| circularAbsDiff = 165° → OFFSHORE
    const result = scoreSlot(
      makeSlot({ windDirectionDegrees: 0 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windDirection).toBe(0);
  });

  it('returns 50 for null wind direction (uncertain)', () => {
    const result = scoreSlot(
      makeSlot({ windDirectionDegrees: null }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.windDirection).toBe(50);
  });
});

// ─── scoreSlot — tideAlignment component ─────────────────────────────────────

describe('scoreSlot — tideAlignment', () => {
  it('returns 100 when slot is exactly at low tide time', () => {
    // Slot at 10:45 = low tide time
    const slot = makeSlot({ timeUtc: '2026-07-26T10:45:00.000Z' });
    const result = scoreSlot(slot, LOW_TIDE_UTC_MS, RULESET, SEAWARD_BEARING);
    expect(result.components.tideAlignment).toBe(100);
  });

  it('returns 50 when slot is a quarter-session-duration away (45 min)', () => {
    // scoreTideAlignment: score = max(0, 100 - (distanceMs / halfDurationMs) * 100)
    // halfDurationMs = 90 min → at 45 min away: 100 - (45/90)*100 = 50
    // Low tide at 10:45, slot at 11:30 → 45 min away
    const slotAt11h30 = makeSlot({ timeUtc: '2026-07-26T11:30:00.000Z' });
    const result = scoreSlot(slotAt11h30, LOW_TIDE_UTC_MS, RULESET, SEAWARD_BEARING);
    expect(result.components.tideAlignment).toBe(50);
  });

  it('returns 0 when slot is a full session duration away (180 min)', () => {
    // 180 min = 3h away → score = max(0, 100 - 200%) = 0
    const slotAt13h45 = makeSlot({ timeUtc: '2026-07-26T13:45:00.000Z' });
    const result = scoreSlot(slotAt13h45, LOW_TIDE_UTC_MS, RULESET, SEAWARD_BEARING);
    expect(result.components.tideAlignment).toBe(0);
  });

  it('returns 50 when lowTideUtcMs is null (uncertain)', () => {
    const result = scoreSlot(makeSlot(), null, RULESET, SEAWARD_BEARING);
    expect(result.components.tideAlignment).toBe(50);
  });

  it('returns a score between 0 and 100 for a slot within the session', () => {
    // 30 min from low tide → 30/90 * 100 = 33 penalty → score = 67
    const slotAt11h15 = makeSlot({ timeUtc: '2026-07-26T11:15:00.000Z' });
    const result = scoreSlot(slotAt11h15, LOW_TIDE_UTC_MS, RULESET, SEAWARD_BEARING);
    expect(result.components.tideAlignment).toBeGreaterThan(50);
    expect(result.components.tideAlignment).toBeLessThan(100);
  });
});

// ─── scoreSlot — gustStability component ─────────────────────────────────────

describe('scoreSlot — gustStability', () => {
  it('returns 100 when gust equals sustained wind (zero spread)', () => {
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: 13, gustSpeedKnots: 13 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.gustStability).toBe(100);
  });

  it('returns 0 at maximumGustSpreadMph (15 mph ≈ 13.03 kt) spread', () => {
    // 15 mph spread = 15 * 0.869 ≈ 13.03 kt spread
    const spreadKnots = 15 * 0.868976;
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: 10, gustSpeedKnots: 10 + spreadKnots }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.gustStability).toBe(0);
  });

  it('returns a partial score for spread between 0 and max', () => {
    // Half the max spread → ~50
    const halfSpread = (15 * 0.868976) / 2;
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: 13, gustSpeedKnots: 13 + halfSpread }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.gustStability).toBeGreaterThan(40);
    expect(result.components.gustStability).toBeLessThan(60);
  });

  it('returns 50 when gustSpeedKnots is null (uncertain)', () => {
    const result = scoreSlot(
      makeSlot({ gustSpeedKnots: null }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.gustStability).toBe(50);
  });

  it('returns 50 when windSpeedKnots is null (uncertain)', () => {
    const result = scoreSlot(
      makeSlot({ windSpeedKnots: null }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.gustStability).toBe(50);
  });
});

// ─── scoreSlot — weather component ───────────────────────────────────────────

describe('scoreSlot — weather', () => {
  it('returns 100 when probabilityOfPrecipitation is 0', () => {
    const result = scoreSlot(
      makeSlot({ probabilityOfPrecipitation: 0 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.weather).toBe(100);
  });

  it('returns 50 when probabilityOfPrecipitation is 50', () => {
    const result = scoreSlot(
      makeSlot({ probabilityOfPrecipitation: 50 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.weather).toBe(50);
  });

  it('returns 0 when probabilityOfPrecipitation is 100', () => {
    const result = scoreSlot(
      makeSlot({ probabilityOfPrecipitation: 100 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.weather).toBe(0);
  });

  it('returns 50 when probabilityOfPrecipitation is null (uncertain)', () => {
    const result = scoreSlot(
      makeSlot({ probabilityOfPrecipitation: null }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.weather).toBe(50);
  });
});

// ─── scoreSlot — confidence component ────────────────────────────────────────

describe('scoreSlot — confidence', () => {
  it('returns 100 when confidence is 1.0', () => {
    const result = scoreSlot(
      makeSlot({ confidence: 1.0 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.confidence).toBe(100);
  });

  it('returns 0 when confidence is 0.0', () => {
    const result = scoreSlot(
      makeSlot({ confidence: 0.0 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.confidence).toBe(0);
  });

  it('returns 90 when confidence is 0.9', () => {
    const result = scoreSlot(
      makeSlot({ confidence: 0.9 }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.confidence).toBe(90);
  });

  it('returns 50 when confidence is null (uncertain)', () => {
    const result = scoreSlot(
      makeSlot({ confidence: null }),
      LOW_TIDE_UTC_MS,
      RULESET,
      SEAWARD_BEARING,
    );
    expect(result.components.confidence).toBe(50);
  });
});

// ─── scoreSlot — totalScore ───────────────────────────────────────────────────

describe('scoreSlot — totalScore', () => {
  it('returns a value in [0, 100]', () => {
    const result = scoreSlot(makeSlot(), LOW_TIDE_UTC_MS, RULESET, SEAWARD_BEARING);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it('returns a high score for an ideal slot at the low tide with good wind', () => {
    // Ideal slot: at low tide, 20 mph onshore, calm gusts, no rain, high confidence
    const ideal = makeSlot({
      timeUtc: '2026-07-26T10:45:00.000Z', // at low tide
      windSpeedKnots: 17.38, // ~20 mph (preferred range)
      windDirectionDegrees: 200, // DIRECT_ONSHORE
      gustSpeedKnots: 18.25, // ~21 mph, small spread
      probabilityOfPrecipitation: 0,
      confidence: 1.0,
    });
    const result = scoreSlot(ideal, LOW_TIDE_UTC_MS, RULESET, SEAWARD_BEARING);
    expect(result.totalScore).toBeGreaterThanOrEqual(90);
  });

  it('returns a low score for a slot with no wind and offshore direction', () => {
    const bad = makeSlot({
      windSpeedKnots: 0,
      windDirectionDegrees: 15, // OFFSHORE for seaward bearing 195°
      confidence: 0.1,
    });
    const result = scoreSlot(bad, LOW_TIDE_UTC_MS, RULESET, SEAWARD_BEARING);
    expect(result.totalScore).toBeLessThan(30);
  });

  it('falls back to default weights when scoring.weights is empty', () => {
    const rulesetNoWeights: SuitabilityRuleset = {
      ...RULESET,
      scoring: {},
    };
    const result = scoreSlot(makeSlot(), LOW_TIDE_UTC_MS, rulesetNoWeights, SEAWARD_BEARING);
    // Should still produce a valid score using defaults
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });
});

// ─── scoreWindow ──────────────────────────────────────────────────────────────

describe('scoreWindow', () => {
  it('returns score in [0, 100]', () => {
    const result = scoreWindow(makeInput());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('returns weakestSlotScore in [0, 100]', () => {
    const result = scoreWindow(makeInput());
    expect(result.weakestSlotScore).toBeGreaterThanOrEqual(0);
    expect(result.weakestSlotScore).toBeLessThanOrEqual(100);
  });

  it('weakestSlotScore is always ≤ score (average ≥ minimum)', () => {
    const result = scoreWindow(makeInput());
    expect(result.weakestSlotScore).toBeLessThanOrEqual(result.score);
  });

  it('returns slotScores with one entry per window slot', () => {
    const slots = makeSlots(12);
    const result = scoreWindow(makeInput({ windowSlots: slots }));
    expect(result.slotScores).toHaveLength(12);
  });

  it('returns score=0 and weakestSlotScore=0 for empty window', () => {
    const result = scoreWindow(makeInput({ windowSlots: [] }));
    expect(result.score).toBe(0);
    expect(result.weakestSlotScore).toBe(0);
    expect(result.slotScores).toHaveLength(0);
  });

  it('score equals slot score for a single-slot window', () => {
    const slots = [makeSlot()];
    const result = scoreWindow(makeInput({ windowSlots: slots }));
    expect(result.score).toBe(result.slotScores[0]!.totalScore);
    expect(result.weakestSlotScore).toBe(result.slotScores[0]!.totalScore);
  });

  it('scoreComponents are averages across slots', () => {
    // Two slots: one with 0% precip (weather=100), one with 100% precip (weather=0)
    const slots = [
      makeSlot({ timeUtc: '2026-07-26T10:00:00.000Z', probabilityOfPrecipitation: 0 }),
      makeSlot({ timeUtc: '2026-07-26T10:15:00.000Z', probabilityOfPrecipitation: 100 }),
    ];
    const result = scoreWindow(makeInput({ windowSlots: slots }));
    expect(result.scoreComponents.weather).toBe(50); // average of 100 and 0
  });

  it('weakestSlotScore reflects the worst slot', () => {
    // Mostly good slots, one slot with wind below minimum
    const slots = makeSlots(12);
    slots[6]!.windSpeedKnots = 4; // ~4.6 mph → below minimumUsableMph (8)
    slots[6]!.windDirectionDegrees = 10; // OFFSHORE → 0 direction score

    const result = scoreWindow(makeInput({ windowSlots: slots }));
    const worstSlot = result.slotScores[6]!;

    expect(result.weakestSlotScore).toBe(worstSlot.totalScore);
    expect(result.weakestSlotScore).toBeLessThan(result.score);
  });
});

// ─── determineStatus — weakest-point enforcement ──────────────────────────────

describe('determineStatus', () => {
  const thresholds = RULESET.thresholds;

  it('returns GO when both score and weakestSlotScore are ≥ 70', () => {
    expect(determineStatus(85, 75, thresholds)).toBe('GO');
  });

  it('returns MARGINAL when both are ≥ 40 but below 70', () => {
    expect(determineStatus(60, 50, thresholds)).toBe('MARGINAL');
  });

  it('returns NO_GO when both are below 40', () => {
    expect(determineStatus(30, 20, thresholds)).toBe('NO_GO');
  });

  // Weakest-point regression tests

  it('returns MARGINAL (not GO) when average is GO but weakest slot is only 60', () => {
    // score=80 (GO), weakestSlot=60 (MARGINAL threshold) → effective=60 → MARGINAL
    expect(determineStatus(80, 60, thresholds)).toBe('MARGINAL');
  });

  it('returns NO_GO when average is GO but weakest slot is below marginal threshold', () => {
    // score=85 (GO), weakestSlot=35 (below 40) → effective=35 → NO_GO
    expect(determineStatus(85, 35, thresholds)).toBe('NO_GO');
  });

  it('returns NO_GO when average is MARGINAL but weakest slot is below marginal threshold', () => {
    // score=55 (MARGINAL), weakestSlot=25 → effective=25 → NO_GO
    expect(determineStatus(55, 25, thresholds)).toBe('NO_GO');
  });

  it('returns GO at exactly the go threshold on both', () => {
    expect(determineStatus(70, 70, thresholds)).toBe('GO');
  });

  it('returns MARGINAL at exactly the marginal threshold on both', () => {
    expect(determineStatus(40, 40, thresholds)).toBe('MARGINAL');
  });

  it('returns NO_GO when one point below marginal even if average is high', () => {
    // score=90, weakestSlot=39 → effective=39 < 40 → NO_GO
    expect(determineStatus(90, 39, thresholds)).toBe('NO_GO');
  });
});

// ─── Threshold and regression tests ──────────────────────────────────────────

describe('scoring thresholds — regression', () => {
  it('an ideal window scores GO', () => {
    // All slots at low tide time, perfect conditions
    const slots = makeSlots(12, {
      timeUtc: '2026-07-26T10:45:00.000Z',
      windSpeedKnots: 17.38, // ~20 mph preferred
      windDirectionDegrees: 200, // DIRECT_ONSHORE
      gustSpeedKnots: 18.25, // small spread
      probabilityOfPrecipitation: 0,
      confidence: 1.0,
    });
    const result = scoreWindow(makeInput({ windowSlots: slots }));
    const status = determineStatus(result.score, result.weakestSlotScore, RULESET.thresholds);
    expect(status).toBe('GO');
  });

  it('a window with offshore wind on most slots scores NO_GO', () => {
    const slots = makeSlots(12, {
      windDirectionDegrees: 15, // OFFSHORE for bearing 195°
      windSpeedKnots: 6, // below minimumUsable
    });
    const result = scoreWindow(makeInput({ windowSlots: slots }));
    const status = determineStatus(result.score, result.weakestSlotScore, RULESET.thresholds);
    expect(status).toBe('NO_GO');
  });

  it('a window with one very weak slot cannot achieve GO status', () => {
    // 11 ideal slots + 1 offshore/no-wind slot
    const slots = [
      ...makeSlots(11, {
        timeUtc: '2026-07-26T10:45:00.000Z',
        windSpeedKnots: 17.38,
        windDirectionDegrees: 200,
        gustSpeedKnots: 18.25,
        probabilityOfPrecipitation: 0,
        confidence: 1.0,
      }),
      makeSlot({
        timeUtc: '2026-07-26T13:45:00.000Z',
        windSpeedKnots: 0,
        windDirectionDegrees: 15, // OFFSHORE
        confidence: 0.0,
      }),
    ];
    const result = scoreWindow(makeInput({ windowSlots: slots }));
    const status = determineStatus(result.score, result.weakestSlotScore, RULESET.thresholds);
    // Average might be high, but weakest slot is very low → not GO
    expect(status).not.toBe('GO');
  });

  it('score components sum is correctly weighted', () => {
    // A slot with all uncertain/null values (50 for direction, tide, gust, weather, conf)
    // and zero wind → windSpeed=0
    // Weighted average: (0*30 + 50*25 + 50*20 + 50*15 + 50*5 + 50*5) / 100
    //                 = (0 + 1250 + 1000 + 750 + 250 + 250) / 100
    //                 = 3500 / 100 = 35
    const slot = makeSlot({
      windSpeedKnots: 0,
      windDirectionDegrees: null,
      gustSpeedKnots: null,
      probabilityOfPrecipitation: null,
      confidence: null,
    });
    const result = scoreSlot(slot, null, RULESET, SEAWARD_BEARING);
    expect(result.components.windSpeed).toBe(0);
    expect(result.components.windDirection).toBe(50);
    expect(result.components.weather).toBe(50);
    expect(result.components.confidence).toBe(50);
    expect(result.totalScore).toBe(35);
  });
});
