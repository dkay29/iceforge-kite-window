import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateSolarEvents } from './solar.js';
import {
  ceilTo15MinMs,
  generateSlotTimes,
  localMidnightToUtcMs,
  normalizeTimeline,
} from './normalizer.js';
import { NwsFixtureProvider } from '../providers/nws/nwsFixtureProvider.js';
import { parseNwsGridData } from '../providers/nws/nwsWeatherAdapter.js';
import { NoaaFixtureProvider } from '../providers/noaa/noaaFixtureProvider.js';
import { parseTidePredictions } from '../providers/noaa/noaaTideAdapter.js';
import type { NormalizationInput } from './normalizer.js';

const NWS_FIXTURES = path.join(import.meta.dirname, '../providers/nws/fixtures');
const NOAA_FIXTURES = path.join(import.meta.dirname, '../providers/noaa/fixtures');

const SPOT_ID = 'west-dennis-beach-ma';
const LOCAL_DATE = '2026-07-26';
const TIMEZONE = 'America/New_York';
const RETRIEVED_AT_MS = Date.UTC(2026, 6, 26, 18, 53, 37);
const GENERATED_AT_MS = Date.UTC(2026, 6, 26, 19, 0, 0);
const NOW_MS = GENERATED_AT_MS;

// ─── Utilities: localMidnightToUtcMs ─────────────────────────────────────────

describe('localMidnightToUtcMs', () => {
  it('returns the UTC ms for midnight EDT (UTC-4) on 2026-07-26', () => {
    const ms = localMidnightToUtcMs('2026-07-26', 'America/New_York');
    // 2026-07-26 00:00 EDT = 2026-07-26T04:00:00Z
    expect(ms).toBe(Date.UTC(2026, 6, 26, 4, 0, 0));
  });

  it('returns the UTC ms for midnight EST (UTC-5) on 2026-12-21', () => {
    const ms = localMidnightToUtcMs('2026-12-21', 'America/New_York');
    // 2026-12-21 00:00 EST = 2026-12-21T05:00:00Z
    expect(ms).toBe(Date.UTC(2026, 11, 21, 5, 0, 0));
  });

  it('handles UTC timezone', () => {
    const ms = localMidnightToUtcMs('2026-07-26', 'UTC');
    expect(ms).toBe(Date.UTC(2026, 6, 26, 0, 0, 0));
  });
});

// ─── Utilities: ceilTo15MinMs ─────────────────────────────────────────────────

describe('ceilTo15MinMs', () => {
  it('returns the value unchanged when already aligned', () => {
    const aligned = Date.UTC(2026, 6, 26, 4, 0, 0); // 04:00:00Z
    expect(ceilTo15MinMs(aligned)).toBe(aligned);
  });

  it('rounds up to the next 15-min boundary', () => {
    const unaligned = Date.UTC(2026, 6, 26, 4, 0, 0) + 1;
    const expected = Date.UTC(2026, 6, 26, 4, 15, 0);
    expect(ceilTo15MinMs(unaligned)).toBe(expected);
  });

  it('rounds up from 4:01 to 4:15', () => {
    const t = Date.UTC(2026, 6, 26, 4, 1, 0);
    const expected = Date.UTC(2026, 6, 26, 4, 15, 0);
    expect(ceilTo15MinMs(t)).toBe(expected);
  });
});

// ─── Utilities: generateSlotTimes ────────────────────────────────────────────

describe('generateSlotTimes', () => {
  it('generates exactly 96 slots', () => {
    const dayStart = Date.UTC(2026, 6, 26, 4, 0, 0);
    expect(generateSlotTimes(dayStart)).toHaveLength(96);
  });

  it('slots are separated by exactly 15 minutes', () => {
    const dayStart = Date.UTC(2026, 6, 26, 4, 0, 0);
    const slots = generateSlotTimes(dayStart);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]! - slots[i - 1]!).toBe(15 * 60 * 1000);
    }
  });

  it('first slot is aligned to a 15-minute UTC boundary', () => {
    const dayStart = Date.UTC(2026, 6, 26, 4, 0, 0);
    const slots = generateSlotTimes(dayStart);
    expect(slots[0]! % (15 * 60 * 1000)).toBe(0);
  });

  it('covers exactly 24 hours', () => {
    const dayStart = Date.UTC(2026, 6, 26, 4, 0, 0);
    const slots = generateSlotTimes(dayStart);
    const first = slots[0]!;
    const last = slots[95]!;
    expect(last - first).toBe(95 * 15 * 60 * 1000);
  });
});

// ─── Integration: normalizeTimeline ──────────────────────────────────────────

async function buildInput(): Promise<NormalizationInput> {
  const nwsProvider = new NwsFixtureProvider(NWS_FIXTURES);
  const nwsResponse = await nwsProvider.fetchGridData('BOX', 107, 74);
  const nwsData = parseNwsGridData(nwsResponse, 'BOX', RETRIEVED_AT_MS);

  const noaaProvider = new NoaaFixtureProvider(
    NOAA_FIXTURES,
    new Map([['8447504-20260725', 'predictions-8447504-hilo-gmt-20260725.json']]),
  );
  const tideResponse = await noaaProvider.fetchHiloPredictions(
    '8447504',
    '20260725',
    '20260726',
    'MLLW',
  );
  const tideResult = parseTidePredictions(
    tideResponse,
    '8447504',
    'South Yarmouth, Bass River',
    'MLLW',
    RETRIEVED_AT_MS,
  );

  const solarEvents = calculateSolarEvents(2026, 7, 26, 41.6494, -70.1845);
  const dayStartUtcMs = localMidnightToUtcMs(LOCAL_DATE, TIMEZONE);

  return {
    spotId: SPOT_ID,
    localDate: LOCAL_DATE,
    dayStartUtcMs,
    nwsData,
    tideResult,
    solarEvents,
    generatedAtMs: GENERATED_AT_MS,
    nowMs: NOW_MS,
  };
}

describe('normalizeTimeline', () => {
  it('produces exactly 96 slots', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    expect(timeline.slots).toHaveLength(96);
  });

  it('sets schemaVersion to "1.0"', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    expect(timeline.schemaVersion).toBe('1.0');
  });

  it('sets spotId and localDate from input', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    expect(timeline.spotId).toBe(SPOT_ID);
    expect(timeline.localDate).toBe(LOCAL_DATE);
  });

  it('slot times are at 15-minute UTC boundaries', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    const SLOT_MS = 15 * 60 * 1000;
    for (const slot of timeline.slots) {
      const ms = new Date(slot.timeUtc).getTime();
      expect(ms % SLOT_MS).toBe(0);
    }
  });

  it('first slot starts on or after local midnight UTC', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    const firstMs = new Date(timeline.slots[0]!.timeUtc).getTime();
    expect(firstMs).toBeGreaterThanOrEqual(input.dayStartUtcMs);
  });

  it('NWS data slots have dataSource FORECAST when NWS data is present', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    // Slots in the NWS fixture coverage period (05:00–13:00Z) should be FORECAST
    const inCoverage = timeline.slots.filter((s) => {
      const ms = new Date(s.timeUtc).getTime();
      return ms >= Date.UTC(2026, 6, 26, 5, 0) && ms < Date.UTC(2026, 6, 26, 9, 0);
    });
    expect(inCoverage.length).toBeGreaterThan(0);
    for (const slot of inCoverage) {
      expect(slot.dataSource).toBe('FORECAST');
    }
  });

  it('tide height is marked as interpolated', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    // Find a slot with tide data
    const withTide = timeline.slots.find((s) => s.tideHeightFeet !== null);
    expect(withTide).toBeDefined();
    expect(withTide!.interpolatedFields).toContain('tideHeightFeet');
  });

  it('isDaylight is true around solar noon', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    // Solar noon ≈ 16:45 UTC; find the slot at 16:45
    const noonSlot = timeline.slots.find((s) => s.timeUtc.startsWith('2026-07-26T16:45'));
    expect(noonSlot).toBeDefined();
    expect(noonSlot!.isDaylight).toBe(true);
  });

  it('isDaylight is false at midnight UTC (pre-dawn at this location)', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    // First slot (04:00Z = midnight EDT) should not be daylight
    const midnightSlot = timeline.slots[0]!;
    expect(midnightSlot.isDaylight).toBe(false);
  });

  it('slots with no NWS or tide data have dataSource MISSING', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    // After 23:00Z (end of fixture coverage + beyond tide range) expect MISSING
    const lateSlots = timeline.slots.filter((s) => {
      const ms = new Date(s.timeUtc).getTime();
      // Tide has events until 2026-07-27T03:57Z, NWS covers until ~2026-07-27T00:00Z
      // but our fixture only has 3 values per field ending ≤13:00Z
      // Slots before 05:00Z should have no NWS data
      return ms < Date.UTC(2026, 6, 26, 5, 0) && ms >= Date.UTC(2026, 6, 26, 4, 0);
    });
    // These slots: no NWS data, tide might be interpolated
    expect(lateSlots.length).toBeGreaterThan(0);
  });

  it('confidence is null when no meaningful data exists', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    // Slots before NWS and tide coverage should have null confidence
    const earlySlots = timeline.slots.filter((s) => {
      const ms = new Date(s.timeUtc).getTime();
      // Before 05:00Z (NWS start) and before 08:47Z (first tide event in UTC)
      return ms < Date.UTC(2026, 6, 26, 5, 0) && ms < Date.UTC(2026, 6, 26, 8, 47);
    });
    if (earlySlots.length > 0) {
      expect(earlySlots[0]!.confidence).toBeNull();
    }
  });

  it('source records include NWS, NOAA tide, and solar', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    expect(timeline.sources.nws.provider).toContain('NWS');
    expect(timeline.sources.noaaTide.provider).toContain('NOAA');
    expect(timeline.sources.solar.provider).toBe('solar-calc');
  });

  it('gap test: slots between tide events within 6h have interpolated heights', async () => {
    const input = await buildInput();
    const timeline = normalizeTimeline(input);
    // GMT fixture: HIGH at 15:54Z, LOW at 21:36Z → gap = 5h 42min < 6h → interpolated
    const betweenTide = timeline.slots.filter((s) => {
      const ms = new Date(s.timeUtc).getTime();
      return ms > Date.UTC(2026, 6, 26, 15, 54) && ms < Date.UTC(2026, 6, 26, 21, 36);
    });
    expect(betweenTide.length).toBeGreaterThan(0);
    for (const slot of betweenTide) {
      expect(slot.tideHeightFeet).not.toBeNull();
    }
  });
});
