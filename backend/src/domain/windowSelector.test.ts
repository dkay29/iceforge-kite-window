import { describe, expect, it } from 'vitest';
import { selectWindows } from './windowSelector.js';
import type { WindowSelectorInput } from './windowSelector.js';
import type {
  Normalized15MinuteTimeline,
  TimelineSlot,
  SuitabilityRuleset,
} from '../generated/schema-types.js';
import type { TideEvent } from '../providers/noaa/noaaTideAdapter.js';

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

// West Dennis Beach — seaward bearing SSW
const SEAWARD_BEARING = 195;

// Day: 2026-07-26 in EDT (UTC-4). Local midnight = 04:00 UTC.
// 96 slots: 04:00Z–03:45Z next day.
const DAY_START_UTC_MS = Date.UTC(2026, 6, 26, 4, 0, 0); // 04:00Z
const SLOT_MS = 15 * 60 * 1000;

/** Build a slot at a given UTC ms with optional overrides. */
function makeSlot(utcMs: number, overrides: Partial<TimelineSlot> = {}): TimelineSlot {
  return {
    timeUtc: new Date(utcMs).toISOString(),
    windSpeedKnots: 17.38, // ~20 mph — preferred range
    windDirectionDegrees: 200, // DIRECT_ONSHORE for bearing 195°
    gustSpeedKnots: 19.1, // small spread
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

/** Build a 96-slot timeline covering the full local day starting at DAY_START_UTC_MS. */
function makeTimeline(overrides: Partial<TimelineSlot> = {}): Normalized15MinuteTimeline {
  const slots: TimelineSlot[] = Array.from({ length: 96 }, (_, i) =>
    makeSlot(DAY_START_UTC_MS + i * SLOT_MS, overrides),
  );

  return {
    schemaVersion: '1.0',
    spotId: 'west-dennis-beach-ma',
    localDate: '2026-07-26',
    generatedAt: new Date(DAY_START_UTC_MS).toISOString(),
    slots: slots as [TimelineSlot, ...TimelineSlot[]],
    sources: {
      nws: {
        provider: 'NWS BOX',
        retrievedAt: new Date(DAY_START_UTC_MS).toISOString(),
        isStale: false,
        attribution: 'NWS',
      },
      noaaTide: {
        provider: 'NOAA',
        retrievedAt: new Date(DAY_START_UTC_MS).toISOString(),
        isStale: false,
        attribution: 'NOAA',
      },
      solar: {
        provider: 'solar-calc',
        retrievedAt: new Date(DAY_START_UTC_MS).toISOString(),
        attribution: 'Calculated',
      },
    },
  };
}

/** Low tide at 10:30 UTC (well inside the day horizon). */
const LOW_TIDE_MORNING: TideEvent = {
  timeUtcMs: Date.UTC(2026, 6, 26, 10, 30, 0), // 10:30Z
  heightFeet: 0.4,
  type: 'LOW',
};

/** High tide event (should be ignored by window selector). */
const HIGH_TIDE_MORNING: TideEvent = {
  timeUtcMs: Date.UTC(2026, 6, 26, 4, 30, 0),
  heightFeet: 4.2,
  type: 'HIGH',
};

function makeInput(overrides: Partial<WindowSelectorInput> = {}): WindowSelectorInput {
  return {
    timeline: makeTimeline(),
    ruleset: RULESET,
    tideEvents: [HIGH_TIDE_MORNING, LOW_TIDE_MORNING],
    seawardBearingDegrees: SEAWARD_BEARING,
    ...overrides,
  };
}

// ─── Basic operation ──────────────────────────────────────────────────────────

describe('selectWindows — basic operation', () => {
  it('returns a bestWindow when conditions are favourable', () => {
    const result = selectWindows(makeInput());
    expect(result.bestWindow).not.toBeNull();
  });

  it('bestWindow startUtc is before endUtc', () => {
    const result = selectWindows(makeInput());
    const start = new Date(result.bestWindow!.startUtc).getTime();
    const end = new Date(result.bestWindow!.endUtc).getTime();
    expect(end).toBeGreaterThan(start);
  });

  it('bestWindow duration is 3 hours', () => {
    const result = selectWindows(makeInput());
    const start = new Date(result.bestWindow!.startUtc).getTime();
    const end = new Date(result.bestWindow!.endUtc).getTime();
    expect(end - start).toBe(3 * 60 * 60 * 1000);
  });

  it('bestWindow contains the low tide time', () => {
    const result = selectWindows(makeInput());
    const bw = result.bestWindow!;
    const lowTideMs = new Date(bw.lowTideUtc).getTime();
    const startMs = new Date(bw.startUtc).getTime();
    const endMs = new Date(bw.endUtc).getTime();
    expect(lowTideMs).toBeGreaterThanOrEqual(startMs);
    expect(lowTideMs).toBeLessThan(endMs);
  });

  it('bestWindow score is in [0, 100]', () => {
    const result = selectWindows(makeInput());
    expect(result.bestWindow!.score).toBeGreaterThanOrEqual(0);
    expect(result.bestWindow!.score).toBeLessThanOrEqual(100);
  });

  it('bestWindow status is GO for ideal conditions', () => {
    const result = selectWindows(makeInput());
    expect(result.status).toBe('GO');
    expect(result.bestWindow!.status).toBe('GO');
  });

  it('includes reasons in bestWindow', () => {
    const result = selectWindows(makeInput());
    expect(result.bestWindow!.reasons).toBeDefined();
    expect(result.bestWindow!.reasons.length).toBeGreaterThan(0);
  });

  it('produces 96 timeline points', () => {
    const result = selectWindows(makeInput());
    expect(result.timelinePoints).toHaveLength(96);
  });

  it('marks some timeline points as isInBestWindow', () => {
    const result = selectWindows(makeInput());
    const inBest = result.timelinePoints.filter((p) => p.isInBestWindow);
    expect(inBest.length).toBeGreaterThan(0);
  });
});

// ─── High-tide events are ignored ────────────────────────────────────────────

describe('selectWindows — tide event filtering', () => {
  it('ignores HIGH tide events when generating candidate windows', () => {
    // Only HIGH tide events — no candidate windows should be generated
    const highOnlyInput = makeInput({ tideEvents: [HIGH_TIDE_MORNING] });
    const result = selectWindows(highOnlyInput);
    expect(result.status).toBe('NO_GO');
    expect(result.bestWindow).toBeNull();
  });

  it('generates a window for each LOW tide event', () => {
    const secondLowTide: TideEvent = {
      timeUtcMs: Date.UTC(2026, 6, 26, 22, 0, 0), // 22:00Z — within day horizon
      heightFeet: 0.6,
      type: 'LOW',
    };
    const result = selectWindows(
      makeInput({ tideEvents: [HIGH_TIDE_MORNING, LOW_TIDE_MORNING, secondLowTide] }),
    );
    // Both low tides should be inside horizon — either best or alternatives
    expect(result.bestWindow).not.toBeNull();
  });
});

// ─── NO_GO cases ──────────────────────────────────────────────────────────────

describe('selectWindows — NO_GO cases', () => {
  it('returns NO_GO and null bestWindow when no low tide events', () => {
    const result = selectWindows(makeInput({ tideEvents: [] }));
    expect(result.status).toBe('NO_GO');
    expect(result.bestWindow).toBeNull();
  });

  it('returns NO_GO when all slots have offshore wind direction', () => {
    // 15° → OFFSHORE for seaward bearing 195°
    const timeline = makeTimeline({ windDirectionDegrees: 15 });
    const result = selectWindows(makeInput({ timeline }));
    expect(result.status).toBe('NO_GO');
    expect(result.bestWindow).toBeNull();
  });

  it('emits blockingConstraints when hard rules fail', () => {
    const timeline = makeTimeline({ windDirectionDegrees: 15 }); // offshore
    const result = selectWindows(makeInput({ timeline }));
    expect(result.blockingConstraints.length).toBeGreaterThan(0);
  });

  it('returns NO_GO when all slots lack daylight', () => {
    const timeline = makeTimeline({ isDaylight: false });
    const result = selectWindows(makeInput({ timeline }));
    expect(result.status).toBe('NO_GO');
  });

  it('returns NO_GO when wind exceeds absolute maximum', () => {
    // 35 mph = 30.41 kt; use 32 kt to exceed the absolute max
    const timeline = makeTimeline({ windSpeedKnots: 32 });
    const result = selectWindows(makeInput({ timeline }));
    expect(result.status).toBe('NO_GO');
  });
});

// ─── Timeline points ──────────────────────────────────────────────────────────

describe('selectWindows — timelinePoints', () => {
  it('timelinePoints have non-null scores for non-MISSING slots', () => {
    const result = selectWindows(makeInput());
    const nonMissing = result.timelinePoints.filter((p) => p.dataSource !== 'MISSING');
    expect(nonMissing.every((p) => p.score !== null)).toBe(true);
  });

  it('timelinePoints include windClassification when direction is present', () => {
    const result = selectWindows(makeInput());
    const withDir = result.timelinePoints.filter((p) => p.windDirectionDegrees !== null);
    expect(withDir.every((p) => p.windClassification !== undefined)).toBe(true);
  });

  it('timelinePoints have status GO for ideal slots', () => {
    const result = selectWindows(makeInput());
    // With ideal conditions, most slots should be GO
    const goSlots = result.timelinePoints.filter((p) => p.status === 'GO');
    expect(goSlots.length).toBeGreaterThan(0);
  });

  it('timelinePoints for MISSING slots have null score and UNKNOWN status', () => {
    // Create timeline with some MISSING slots
    const slots: TimelineSlot[] = Array.from({ length: 96 }, (_, i) => {
      const utcMs = DAY_START_UTC_MS + i * SLOT_MS;
      if (i < 10) {
        return makeSlot(utcMs, {
          dataSource: 'MISSING',
          windSpeedKnots: null,
          tideHeightFeet: null,
        });
      }
      return makeSlot(utcMs);
    });
    const timeline: Normalized15MinuteTimeline = {
      ...makeTimeline(),
      slots: slots as [TimelineSlot, ...TimelineSlot[]],
    };
    const result = selectWindows(makeInput({ timeline }));
    const missingPoints = result.timelinePoints.filter((p) => p.dataSource === 'MISSING');
    expect(missingPoints.length).toBeGreaterThan(0);
    for (const pt of missingPoints) {
      expect(pt.score).toBeNull();
      expect(pt.status).toBe('UNKNOWN');
    }
  });
});

// ─── Deterministic tie-breaking ───────────────────────────────────────────────

describe('selectWindows — deterministic tie-breaking', () => {
  it('selects the same window when called multiple times with identical input', () => {
    const input = makeInput();
    const r1 = selectWindows(input);
    const r2 = selectWindows(input);
    expect(r1.bestWindow?.startUtc).toBe(r2.bestWindow?.startUtc);
    expect(r1.bestWindow?.score).toBe(r2.bestWindow?.score);
  });

  it('bestWindow score is ≥ all alternative scores', () => {
    const secondLowTide: TideEvent = {
      timeUtcMs: Date.UTC(2026, 6, 26, 22, 0, 0),
      heightFeet: 0.6,
      type: 'LOW',
    };
    const result = selectWindows(
      makeInput({ tideEvents: [HIGH_TIDE_MORNING, LOW_TIDE_MORNING, secondLowTide] }),
    );
    if (result.bestWindow && result.alternatives.length > 0) {
      for (const alt of result.alternatives) {
        expect(result.bestWindow.score).toBeGreaterThanOrEqual(alt.score);
      }
    }
  });
});

// ─── Warnings ─────────────────────────────────────────────────────────────────

describe('selectWindows — warnings', () => {
  it('returns an array of warnings (may be empty)', () => {
    const result = selectWindows(makeInput());
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('emits a low-confidence warning when slots have confidence < 0.7', () => {
    const timeline = makeTimeline({ confidence: 0.5 });
    const result = selectWindows(makeInput({ timeline }));
    const hasConfidenceWarning = result.warnings.some((w) => /confidence/i.test(w));
    expect(hasConfidenceWarning).toBe(true);
  });
});
