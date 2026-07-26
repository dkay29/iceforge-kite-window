import { describe, expect, it } from 'vitest';
import { calculateSolarEvents, isDaytime } from './solar.js';

// Tolerance for NOAA algorithm (±2 minutes at mid-latitudes)
const TOLERANCE_MS = 3 * 60 * 1000; // 3 minutes

function expectNearMs(actual: number | null, expected: string, toleranceMs = TOLERANCE_MS): void {
  expect(actual).not.toBeNull();
  const expectedMs = new Date(expected).getTime();
  const diff = Math.abs(actual! - expectedMs);
  expect(diff).toBeLessThanOrEqual(toleranceMs);
}

// ─── West Dennis Beach reference case ────────────────────────────────────────
// 41.6494°N, -70.1845°W on 2026-07-26 (summer, EDT = UTC-4)
// Reference values from published-forecast.example.json

describe('calculateSolarEvents — West Dennis Beach 2026-07-26', () => {
  const events = calculateSolarEvents(2026, 7, 26, 41.6494, -70.1845);

  it('returns non-null events (mid-latitude summer)', () => {
    expect(events.sunriseUtcMs).not.toBeNull();
    expect(events.sunsetUtcMs).not.toBeNull();
    expect(events.civilTwilightBeginUtcMs).not.toBeNull();
    expect(events.civilTwilightEndUtcMs).not.toBeNull();
  });

  it('sunrise is within ±3 min of 2026-07-26T09:28:00Z', () => {
    expectNearMs(events.sunriseUtcMs, '2026-07-26T09:28:00Z');
  });

  it('sunset is within ±3 min of 2026-07-27T00:06:00Z', () => {
    expectNearMs(events.sunsetUtcMs, '2026-07-27T00:06:00Z');
  });

  it('civil twilight begins within ±3 min of 2026-07-26T08:57:00Z', () => {
    expectNearMs(events.civilTwilightBeginUtcMs, '2026-07-26T08:57:00Z');
  });

  it('civil twilight ends within ±3 min of 2026-07-27T00:37:00Z', () => {
    expectNearMs(events.civilTwilightEndUtcMs, '2026-07-27T00:37:00Z');
  });

  it('civil twilight begins before sunrise', () => {
    expect(events.civilTwilightBeginUtcMs!).toBeLessThan(events.sunriseUtcMs!);
  });

  it('sunrise is before sunset', () => {
    expect(events.sunriseUtcMs!).toBeLessThan(events.sunsetUtcMs!);
  });

  it('sunset is before civil twilight end', () => {
    expect(events.sunsetUtcMs!).toBeLessThan(events.civilTwilightEndUtcMs!);
  });

  it('all events fall on the correct UTC dates', () => {
    const start = new Date(events.civilTwilightBeginUtcMs!).toISOString().slice(0, 10);
    const end = new Date(events.civilTwilightEndUtcMs!).toISOString().slice(0, 10);
    expect(start).toBe('2026-07-26');
    expect(end).toBe('2026-07-27'); // Summer: sunset after midnight UTC at this longitude
  });
});

// ─── Winter reference case ────────────────────────────────────────────────────
// Same location on 2026-12-21 (winter solstice)
// Expected: shorter day, sunrise around 12:12 UTC (7:12 AM EST), sunset around 21:18 UTC (4:18 PM EST)

describe('calculateSolarEvents — West Dennis Beach 2026-12-21 (winter solstice)', () => {
  const events = calculateSolarEvents(2026, 12, 21, 41.6494, -70.1845);

  it('returns non-null events', () => {
    expect(events.sunriseUtcMs).not.toBeNull();
    expect(events.sunsetUtcMs).not.toBeNull();
  });

  it('day length is shorter than in summer', () => {
    const summerEvents = calculateSolarEvents(2026, 7, 26, 41.6494, -70.1845);
    const summerDayMs = summerEvents.sunsetUtcMs! - summerEvents.sunriseUtcMs!;
    const winterDayMs = events.sunsetUtcMs! - events.sunriseUtcMs!;
    expect(winterDayMs).toBeLessThan(summerDayMs);
  });

  it('civil twilight bounds narrow in winter', () => {
    const summerEvents = calculateSolarEvents(2026, 7, 26, 41.6494, -70.1845);
    const summerSpread =
      summerEvents.civilTwilightEndUtcMs! - summerEvents.civilTwilightBeginUtcMs!;
    const winterSpread = events.civilTwilightEndUtcMs! - events.civilTwilightBeginUtcMs!;
    expect(winterSpread).toBeLessThan(summerSpread);
  });

  it('sunrise is within ±5 min of 2026-12-21T12:04:00Z (7:04 AM EST)', () => {
    // NOAA algorithm result for this location; ~7:04 AM EST = 12:04 UTC
    expectNearMs(events.sunriseUtcMs, '2026-12-21T12:04:00Z', 5 * 60 * 1000);
  });

  it('sunset is within ±5 min of 2026-12-21T21:13:00Z (4:13 PM EST)', () => {
    // NOAA algorithm result for this location; ~4:13 PM EST = 21:13 UTC
    expectNearMs(events.sunsetUtcMs, '2026-12-21T21:13:00Z', 5 * 60 * 1000);
  });
});

// ─── DST boundary ─────────────────────────────────────────────────────────────
// Clocks spring forward: 2026-03-08 02:00 EST → 03:00 EDT
// The solar calculator works in UTC, so DST has no effect on the algorithm.
// Verify that consecutive days produce a smooth sunrise/sunset progression.

describe('calculateSolarEvents — DST spring-forward 2026-03-08', () => {
  it('produces valid events on the spring-forward day', () => {
    const events = calculateSolarEvents(2026, 3, 8, 41.6494, -70.1845);
    expect(events.sunriseUtcMs).not.toBeNull();
    expect(events.sunsetUtcMs).not.toBeNull();
  });

  it('sunrise time-of-day (minutes past UTC midnight) decreases day over day in spring', () => {
    // Compare offset from midnight UTC, not absolute UTC timestamp
    const midnightMar7 = Date.UTC(2026, 2, 7);
    const midnightMar8 = Date.UTC(2026, 2, 8);
    const midnightMar9 = Date.UTC(2026, 2, 9);
    const before = calculateSolarEvents(2026, 3, 7, 41.6494, -70.1845);
    const onDay = calculateSolarEvents(2026, 3, 8, 41.6494, -70.1845);
    const after = calculateSolarEvents(2026, 3, 9, 41.6494, -70.1845);
    const todMs7 = before.sunriseUtcMs! - midnightMar7;
    const todMs8 = onDay.sunriseUtcMs! - midnightMar8;
    const todMs9 = after.sunriseUtcMs! - midnightMar9;
    // Sunrise gets earlier in UTC each day as we approach the equinox in spring
    expect(todMs8).toBeLessThan(todMs7);
    expect(todMs9).toBeLessThan(todMs8);
    // Sunset gets later in UTC each day
    const setTod7 = before.sunsetUtcMs! - midnightMar7;
    const setTod8 = onDay.sunsetUtcMs! - midnightMar8;
    const setTod9 = after.sunsetUtcMs! - midnightMar9;
    expect(setTod8).toBeGreaterThan(setTod7);
    expect(setTod9).toBeGreaterThan(setTod8);
  });
});

// ─── Polar night ──────────────────────────────────────────────────────────────
// Alert, Nunavut, 82.5°N — polar night around winter solstice

describe('calculateSolarEvents — polar night (Alert, Nunavut, 82.5°N)', () => {
  it('returns null sunrise/sunset during polar night (December)', () => {
    const events = calculateSolarEvents(2026, 12, 21, 82.5, -62.3);
    // At 82.5°N in December, the sun never rises
    expect(events.sunriseUtcMs).toBeNull();
    expect(events.sunsetUtcMs).toBeNull();
  });

  it('returns null civil twilight bounds during polar night', () => {
    const events = calculateSolarEvents(2026, 12, 21, 82.5, -62.3);
    expect(events.civilTwilightBeginUtcMs).toBeNull();
    expect(events.civilTwilightEndUtcMs).toBeNull();
  });
});

// ─── Midnight sun ─────────────────────────────────────────────────────────────
// Alert, Nunavut, 82.5°N — midnight sun around summer solstice

describe('calculateSolarEvents — midnight sun (Alert, Nunavut, 82.5°N)', () => {
  it('returns null sunrise/sunset during midnight sun (June)', () => {
    const events = calculateSolarEvents(2026, 6, 21, 82.5, -62.3);
    // At 82.5°N in June, the sun never sets below the horizon
    expect(events.sunriseUtcMs).toBeNull();
    expect(events.sunsetUtcMs).toBeNull();
  });
});

// ─── isDaytime ────────────────────────────────────────────────────────────────

describe('isDaytime', () => {
  const events = calculateSolarEvents(2026, 7, 26, 41.6494, -70.1845);

  it('returns true at solar noon (well within civil twilight)', () => {
    // Solar noon ≈ 16:45 UTC at this longitude in summer
    const solarNoon = Date.UTC(2026, 6, 26, 16, 45, 0);
    expect(isDaytime(solarNoon, events)).toBe(true);
  });

  it('returns false at midnight UTC (local night)', () => {
    const midnight = Date.UTC(2026, 6, 26, 0, 0, 0);
    expect(isDaytime(midnight, events)).toBe(false);
  });

  it('returns false just before civil twilight begin', () => {
    const justBefore = events.civilTwilightBeginUtcMs! - 1;
    expect(isDaytime(justBefore, events)).toBe(false);
  });

  it('returns true at civil twilight begin (inclusive)', () => {
    expect(isDaytime(events.civilTwilightBeginUtcMs!, events)).toBe(true);
  });

  it('returns false at civil twilight end (exclusive)', () => {
    expect(isDaytime(events.civilTwilightEndUtcMs!, events)).toBe(false);
  });

  it('returns true just before civil twilight end', () => {
    const justBefore = events.civilTwilightEndUtcMs! - 1;
    expect(isDaytime(justBefore, events)).toBe(true);
  });

  it('returns false when civil twilight bounds are null (polar regions)', () => {
    const polarNight = calculateSolarEvents(2026, 12, 21, 82.5, -62.3);
    expect(isDaytime(Date.UTC(2026, 11, 21, 12, 0, 0), polarNight)).toBe(false);
  });
});
