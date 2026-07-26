import { describe, expect, it } from 'vitest';
import { buildForecast } from './forecastBuilder.js';
import type { ForecastBuildInput } from './forecastBuilder.js';
import type { Normalized15MinuteTimeline, TimelineSlot } from '../generated/schema-types.js';
import type { TideFetchResult, TideEvent } from '../providers/noaa/noaaTideAdapter.js';
import type { SolarEvents } from './solar.js';
import type { WindowSelectorResult } from './windowSelector.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SPOT = {
  spotId: 'west-dennis-beach-ma',
  name: 'West Dennis Beach',
  region: 'Cape Cod',
  timezone: 'America/New_York',
};

const GENERATED_AT_MS = Date.UTC(2026, 6, 26, 19, 0, 0);
const FORECAST_RUN_ID = '2026-07-26T19:00:00.000Z';
const DAY_START_UTC_MS = Date.UTC(2026, 6, 26, 4, 0, 0);
const SLOT_MS = 15 * 60 * 1000;

const SOLAR_EVENTS: SolarEvents = {
  sunriseUtcMs: Date.UTC(2026, 6, 26, 9, 20, 0),
  sunsetUtcMs: Date.UTC(2026, 6, 26, 23, 58, 0),
  civilTwilightBeginUtcMs: Date.UTC(2026, 6, 26, 8, 50, 0),
  civilTwilightEndUtcMs: Date.UTC(2026, 6, 27, 0, 28, 0),
};

const TIDE_EVENTS: TideEvent[] = [
  { timeUtcMs: Date.UTC(2026, 6, 26, 8, 47, 0), heightFeet: 4.2, type: 'HIGH' },
  { timeUtcMs: Date.UTC(2026, 6, 26, 14, 46, 0), heightFeet: 0.4, type: 'LOW' },
  { timeUtcMs: Date.UTC(2026, 6, 26, 20, 54, 0), heightFeet: 3.8, type: 'HIGH' },
];

const TIDE_RESULT: TideFetchResult = {
  events: TIDE_EVENTS,
  source: {
    provider: 'NOAA CO-OPS',
    stationId: '8447504',
    stationName: 'South Yarmouth, Bass River',
    datum: 'MLLW',
    retrievedAt: '2026-07-26T18:53:37.000Z',
    validFrom: '2026-07-25T00:00:00.000Z',
    validTo: '2026-07-26T23:59:00.000Z',
    attribution: 'NOAA CO-OPS',
  },
};

function makeSlot(utcMs: number, overrides: Partial<TimelineSlot> = {}): TimelineSlot {
  return {
    timeUtc: new Date(utcMs).toISOString(),
    windSpeedKnots: 17.38,
    windDirectionDegrees: 200,
    gustSpeedKnots: 19.1,
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

const TIMELINE: Normalized15MinuteTimeline = {
  schemaVersion: '1.0',
  spotId: SPOT.spotId,
  localDate: '2026-07-26',
  generatedAt: new Date(GENERATED_AT_MS).toISOString(),
  slots: Array.from({ length: 96 }, (_, i) => makeSlot(DAY_START_UTC_MS + i * SLOT_MS)) as [
    TimelineSlot,
    ...TimelineSlot[],
  ],
  sources: {
    nws: {
      provider: 'NWS BOX',
      retrievedAt: '2026-07-26T18:53:37.000Z',
      isStale: false,
      attribution: 'National Weather Service, BOX',
    },
    noaaTide: {
      provider: 'NOAA CO-OPS',
      retrievedAt: '2026-07-26T18:53:37.000Z',
      isStale: false,
      attribution: 'NOAA CO-OPS',
    },
    solar: {
      provider: 'solar-calc',
      retrievedAt: '2026-07-26T19:00:00.000Z',
      attribution: 'Calculated from spot coordinates and IANA timezone',
    },
  },
};

const WINDOW_RESULT: WindowSelectorResult = {
  status: 'GO',
  bestWindow: {
    startUtc: '2026-07-26T13:16:00.000Z',
    endUtc: '2026-07-26T16:16:00.000Z',
    status: 'GO',
    score: 88,
    weakestSlotScore: 75,
    lowTideUtc: '2026-07-26T14:46:00.000Z',
    reasons: ['Wind 18–22 mph during session', 'Direct onshore wind direction'],
    scoreComponents: {
      windSpeed: 100,
      windDirection: 100,
      tideAlignment: 85,
      gustStability: 90,
      weather: 95,
      confidence: 90,
    },
  },
  alternatives: [],
  blockingConstraints: [],
  warnings: [],
  timelinePoints: Array.from({ length: 96 }, (_, i) => ({
    timeUtc: new Date(DAY_START_UTC_MS + i * SLOT_MS).toISOString(),
    status: 'GO' as const,
    score: 88,
  })),
};

function makeInput(overrides: Partial<ForecastBuildInput> = {}): ForecastBuildInput {
  return {
    spot: SPOT,
    localDate: '2026-07-26',
    tideResult: TIDE_RESULT,
    solarEvents: SOLAR_EVENTS,
    timeline: TIMELINE,
    windowResult: WINDOW_RESULT,
    generatedAtMs: GENERATED_AT_MS,
    forecastRunId: FORECAST_RUN_ID,
    ...overrides,
  };
}

// ─── Schema fields ────────────────────────────────────────────────────────────

describe('buildForecast — schema fields', () => {
  it('sets schemaVersion to "1.0"', () => {
    const doc = buildForecast(makeInput());
    expect(doc.schemaVersion).toBe('1.0');
  });

  it('sets spot fields from the spot summary', () => {
    const doc = buildForecast(makeInput());
    expect(doc.spot.spotId).toBe(SPOT.spotId);
    expect(doc.spot.name).toBe(SPOT.name);
    expect(doc.spot.region).toBe(SPOT.region);
    expect(doc.spot.timezone).toBe(SPOT.timezone);
  });

  it('omits spot.region when not provided', () => {
    const doc = buildForecast(makeInput({ spot: { ...SPOT, region: undefined } }));
    expect(doc.spot.region).toBeUndefined();
  });

  it('sets localDate', () => {
    const doc = buildForecast(makeInput());
    expect(doc.localDate).toBe('2026-07-26');
  });

  it('sets revision to forecastRunId', () => {
    const doc = buildForecast(makeInput());
    expect(doc.revision).toBe(FORECAST_RUN_ID);
  });
});

// ─── Freshness ────────────────────────────────────────────────────────────────

describe('buildForecast — freshness timestamps', () => {
  it('generatedAt matches generatedAtMs', () => {
    const doc = buildForecast(makeInput());
    expect(new Date(doc.generatedAt).getTime()).toBe(GENERATED_AT_MS);
  });

  it('expiresAt defaults to generatedAt + 4 hours', () => {
    const doc = buildForecast(makeInput());
    const expectedExpiry = GENERATED_AT_MS + 4 * 60 * 60 * 1000;
    expect(new Date(doc.expiresAt).getTime()).toBe(expectedExpiry);
  });

  it('expiresAt respects a custom freshnessMs', () => {
    const doc = buildForecast(makeInput({ freshnessMs: 2 * 60 * 60 * 1000 }));
    const expectedExpiry = GENERATED_AT_MS + 2 * 60 * 60 * 1000;
    expect(new Date(doc.expiresAt).getTime()).toBe(expectedExpiry);
  });

  it('expiresAt is after generatedAt', () => {
    const doc = buildForecast(makeInput());
    expect(new Date(doc.expiresAt).getTime()).toBeGreaterThan(new Date(doc.generatedAt).getTime());
  });
});

// ─── Daylight ─────────────────────────────────────────────────────────────────

describe('buildForecast — daylight', () => {
  it('sets sunrise from solarEvents', () => {
    const doc = buildForecast(makeInput());
    expect(new Date(doc.daylight.sunriseUtc).getTime()).toBe(SOLAR_EVENTS.sunriseUtcMs);
  });

  it('sets sunset from solarEvents', () => {
    const doc = buildForecast(makeInput());
    expect(new Date(doc.daylight.sunsetUtc).getTime()).toBe(SOLAR_EVENTS.sunsetUtcMs);
  });

  it('sets civil twilight begin from solarEvents', () => {
    const doc = buildForecast(makeInput());
    expect(new Date(doc.daylight.civilTwilightBeginUtc).getTime()).toBe(
      SOLAR_EVENTS.civilTwilightBeginUtcMs,
    );
  });

  it('sets civil twilight end from solarEvents', () => {
    const doc = buildForecast(makeInput());
    expect(new Date(doc.daylight.civilTwilightEndUtc).getTime()).toBe(
      SOLAR_EVENTS.civilTwilightEndUtcMs,
    );
  });

  it('throws when sunrise is null (polar night)', () => {
    const nullSolar: SolarEvents = { ...SOLAR_EVENTS, sunriseUtcMs: null };
    expect(() => buildForecast(makeInput({ solarEvents: nullSolar }))).toThrow();
  });

  it('throws when any civil twilight value is null', () => {
    const nullSolar: SolarEvents = { ...SOLAR_EVENTS, civilTwilightBeginUtcMs: null };
    expect(() => buildForecast(makeInput({ solarEvents: nullSolar }))).toThrow();
  });
});

// ─── Tide events ──────────────────────────────────────────────────────────────

describe('buildForecast — tideEvents', () => {
  it('includes all tide events from tideResult', () => {
    const doc = buildForecast(makeInput());
    expect(doc.tideEvents).toHaveLength(TIDE_EVENTS.length);
  });

  it('tide event timeUtc is a valid ISO 8601 string', () => {
    const doc = buildForecast(makeInput());
    for (const event of doc.tideEvents) {
      expect(() => new Date(event.timeUtc)).not.toThrow();
      expect(new Date(event.timeUtc).getTime()).not.toBeNaN();
    }
  });

  it('tide event types match source', () => {
    const doc = buildForecast(makeInput());
    expect(doc.tideEvents[0]!.type).toBe('HIGH');
    expect(doc.tideEvents[1]!.type).toBe('LOW');
    expect(doc.tideEvents[2]!.type).toBe('HIGH');
  });

  it('tide events include station name and datum', () => {
    const doc = buildForecast(makeInput());
    for (const event of doc.tideEvents) {
      expect(event.station).toBe(TIDE_RESULT.source.stationName);
      expect(event.datum).toBe(TIDE_RESULT.source.datum);
    }
  });
});

// ─── Assessment ───────────────────────────────────────────────────────────────

describe('buildForecast — assessment', () => {
  it('assessment status matches windowResult status', () => {
    const doc = buildForecast(makeInput());
    expect(doc.assessment.status).toBe(WINDOW_RESULT.status);
  });

  it('assessment bestWindow matches windowResult bestWindow', () => {
    const doc = buildForecast(makeInput());
    expect(doc.assessment.bestWindow?.score).toBe(WINDOW_RESULT.bestWindow!.score);
    expect(doc.assessment.bestWindow?.startUtc).toBe(WINDOW_RESULT.bestWindow!.startUtc);
  });

  it('assessment includes 96 timeline points', () => {
    const doc = buildForecast(makeInput());
    expect(doc.assessment.timelinePoints).toHaveLength(96);
  });

  it('assessment has empty alternatives when none provided', () => {
    const doc = buildForecast(makeInput());
    expect(doc.assessment.alternatives).toHaveLength(0);
  });

  it('assessment omits blockingConstraints when empty', () => {
    const doc = buildForecast(makeInput());
    expect(doc.assessment.blockingConstraints).toBeUndefined();
  });

  it('assessment includes blockingConstraints when non-empty', () => {
    const noGoResult: WindowSelectorResult = {
      ...WINDOW_RESULT,
      status: 'NO_GO',
      bestWindow: null,
      blockingConstraints: ['Wind direction not accepted'],
    };
    const doc = buildForecast(makeInput({ windowResult: noGoResult }));
    expect(doc.assessment.blockingConstraints).toEqual(['Wind direction not accepted']);
  });

  it('throws when timelinePoints is empty', () => {
    const emptyResult: WindowSelectorResult = {
      ...WINDOW_RESULT,
      timelinePoints: [],
    };
    expect(() => buildForecast(makeInput({ windowResult: emptyResult }))).toThrow();
  });
});

// ─── Source attribution ───────────────────────────────────────────────────────

describe('buildForecast — sourceAttribution', () => {
  it('includes NWS, NOAA tide, and solar providers', () => {
    const doc = buildForecast(makeInput());
    const providers = doc.sourceAttribution?.map((a) => a.provider) ?? [];
    expect(providers).toContain('NWS BOX');
    expect(providers).toContain('NOAA CO-OPS');
    expect(providers).toContain('solar-calc');
  });

  it('attribution records include retrievedAt timestamps', () => {
    const doc = buildForecast(makeInput());
    for (const record of doc.sourceAttribution ?? []) {
      expect(record.retrievedAt).toBeDefined();
      expect(() => new Date(record.retrievedAt)).not.toThrow();
    }
  });
});
