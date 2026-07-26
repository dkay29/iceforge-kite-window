import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NwsFixtureProvider } from './nwsFixtureProvider.js';
import { parseNwsGridData } from './nwsWeatherAdapter.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const OFFICE = 'BOX';
const RETRIEVED_AT_MS = Date.UTC(2026, 6, 26, 18, 53, 37); // 2026-07-26T18:53:37Z

async function loadFixtureData() {
  const provider = new NwsFixtureProvider(FIXTURES_DIR);
  const response = await provider.fetchGridData(OFFICE, 107, 74);
  return parseNwsGridData(response, OFFICE, RETRIEVED_AT_MS);
}

// ─── Integration tests — captured grid data fixture ───────────────────────────

describe('parseNwsGridData — integration with NwsFixtureProvider', () => {
  it('parses without error', async () => {
    const data = await loadFixtureData();
    expect(data).toBeDefined();
  });

  it('returns three wind direction intervals from the fixture', async () => {
    const data = await loadFixtureData();
    expect(data.windDirectionIntervals).toHaveLength(3);
  });

  it('preserves wind direction values as degrees (no conversion)', async () => {
    const data = await loadFixtureData();
    // First value in fixture: 40 degrees
    expect(data.windDirectionIntervals[0]!.value).toBeCloseTo(40);
  });

  it('converts wind speed from km/h to knots', async () => {
    const data = await loadFixtureData();
    // First value: 9.26 km/h * 0.539957 = ~5.0 kt
    const knots = data.windSpeedKnotsIntervals[0]!.value!;
    expect(knots).toBeCloseTo(9.26 * 0.539957, 3);
  });

  it('converts gust speed from km/h to knots', async () => {
    const data = await loadFixtureData();
    // First gust: 20.372 km/h * 0.539957 ≈ 11 kt
    const knots = data.windGustKnotsIntervals[0]!.value!;
    expect(knots).toBeCloseTo(20.372 * 0.539957, 3);
  });

  it('preserves sky cover as percent (no conversion)', async () => {
    const data = await loadFixtureData();
    expect(data.skyCoverPercentIntervals[0]!.value).toBe(19);
  });

  it('preserves temperature in Celsius (no conversion)', async () => {
    const data = await loadFixtureData();
    // First temperature value: 17.777...°C
    expect(data.temperatureCelsiusIntervals[0]!.value).toBeCloseTo(17.78, 1);
  });

  it('sets interval endUtcMs = startUtcMs + duration', async () => {
    const data = await loadFixtureData();
    const first = data.windDirectionIntervals[0]!;
    // First validTime: "2026-07-26T05:00:00+00:00/PT4H"
    const expectedStart = Date.UTC(2026, 6, 26, 5, 0, 0);
    const expectedEnd = expectedStart + 4 * 3600000;
    expect(first.startUtcMs).toBe(expectedStart);
    expect(first.endUtcMs).toBe(expectedEnd);
  });

  it('handles multi-day duration P1DT7H correctly', async () => {
    const data = await loadFixtureData();
    // thunderProbability first interval: P1DT7H = 31 hours
    const first = data.thunderProbabilityIntervals[0]!;
    const durationMs = first.endUtcMs - first.startUtcMs;
    expect(durationMs).toBe(31 * 3600000);
  });

  it('source record has the correct provider string', async () => {
    const data = await loadFixtureData();
    expect(data.source.provider).toBe('NWS BOX');
  });

  it('source record has the correct office', async () => {
    const data = await loadFixtureData();
    expect(data.source.office).toBe(OFFICE);
  });

  it('source retrievedAt matches the supplied timestamp', async () => {
    const data = await loadFixtureData();
    expect(data.source.retrievedAt).toBe(new Date(RETRIEVED_AT_MS).toISOString());
  });

  it('source updateTime matches the fixture value', async () => {
    const data = await loadFixtureData();
    expect(data.source.updateTime).toBe('2026-07-26T11:21:01+00:00');
  });

  it('source validFrom is the earliest interval start', async () => {
    const data = await loadFixtureData();
    expect(data.source.validFrom).toBeDefined();
    // Earliest is 2026-07-26T05:00:00Z
    expect(data.source.validFrom).toBe('2026-07-26T05:00:00.000Z');
  });

  it('source attribution references NWS', async () => {
    const data = await loadFixtureData();
    expect(data.source.attribution).toMatch(/National Weather Service/i);
  });
});

// ─── Empty fixture ────────────────────────────────────────────────────────────

describe('parseNwsGridData — empty values fixture', () => {
  it('returns empty interval arrays and null validity', async () => {
    const overrides = new Map([['BOX-107-74', 'empty-griddata.json']]);
    const provider = new NwsFixtureProvider(FIXTURES_DIR, overrides);
    const response = await provider.fetchGridData(OFFICE, 107, 74);
    const data = parseNwsGridData(response, OFFICE, RETRIEVED_AT_MS);
    expect(data.windDirectionIntervals).toHaveLength(0);
    expect(data.windSpeedKnotsIntervals).toHaveLength(0);
    expect(data.source.validFrom).toBeNull();
    expect(data.source.validTo).toBeNull();
  });
});

// ─── Unit tests for duration parsing ──────────────────────────────────────────

describe('parseNwsGridData — interval boundary arithmetic', () => {
  it('correctly computes PT1H duration', async () => {
    const provider = new NwsFixtureProvider(FIXTURES_DIR);
    const response = await provider.fetchGridData(OFFICE, 107, 74);
    const data = parseNwsGridData(response, OFFICE, RETRIEVED_AT_MS);
    // skyCover second interval: "2026-07-26T06:00:00+00:00/PT1H"
    const second = data.skyCoverPercentIntervals[1]!;
    expect(second.endUtcMs - second.startUtcMs).toBe(3600000);
  });

  it('correctly computes PT2H duration', async () => {
    const provider = new NwsFixtureProvider(FIXTURES_DIR);
    const response = await provider.fetchGridData(OFFICE, 107, 74);
    const data = parseNwsGridData(response, OFFICE, RETRIEVED_AT_MS);
    // windSpeed second interval: "2026-07-26T09:00:00+00:00/PT1H"
    // Third interval: "2026-07-26T10:00:00+00:00/PT2H"
    const third = data.windSpeedKnotsIntervals[2]!;
    expect(third.endUtcMs - third.startUtcMs).toBe(2 * 3600000);
  });
});
