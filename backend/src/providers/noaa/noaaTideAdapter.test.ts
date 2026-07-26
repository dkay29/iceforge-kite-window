import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoaaTideResponse } from '../types.js';
import { NoaaFixtureProvider } from './noaaFixtureProvider.js';
import { parseTidePredictions } from './noaaTideAdapter.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');

const STATION_ID = '8447504';
const STATION_NAME = 'South Yarmouth, Bass River';
const DATUM = 'MLLW';
// 2026-07-26T05:30:00Z
const RETRIEVED_AT_MS = 1753504200000;

// ─── Integration tests via fixture provider ───────────────────────────────────

describe('parseTidePredictions — integration with NoaaFixtureProvider', () => {
  async function loadFixture(): Promise<NoaaTideResponse> {
    const overrides = new Map([
      [`${STATION_ID}-20260725`, 'predictions-8447504-hilo-gmt-20260725.json'],
    ]);
    const provider = new NoaaFixtureProvider(FIXTURES_DIR, overrides);
    return provider.fetchHiloPredictions(STATION_ID, '20260725', '20260726', DATUM);
  }

  it('returns 8 tide events from the GMT fixture', async () => {
    const response = await loadFixture();
    const result = parseTidePredictions(response, STATION_ID, STATION_NAME, DATUM, RETRIEVED_AT_MS);
    expect(result.events).toHaveLength(8);
  });

  it('events are sorted ascending by time', async () => {
    const response = await loadFixture();
    const { events } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.timeUtcMs).toBeGreaterThan(events[i - 1]!.timeUtcMs);
    }
  });

  it('first event is the 2026-07-25 08:47 UTC LOW tide', async () => {
    const response = await loadFixture();
    const { events } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    const first = events[0]!;
    expect(first.type).toBe('LOW');
    expect(first.heightFeet).toBeCloseTo(0.398);
    // 2026-07-25T08:47:00Z
    expect(new Date(first.timeUtcMs).toISOString()).toBe('2026-07-25T08:47:00.000Z');
  });

  it('last event is the 2026-07-27 03:57 UTC HIGH tide', async () => {
    const response = await loadFixture();
    const { events } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    const last = events[events.length - 1]!;
    expect(last.type).toBe('HIGH');
    expect(last.heightFeet).toBeCloseTo(2.8);
    expect(new Date(last.timeUtcMs).toISOString()).toBe('2026-07-27T03:57:00.000Z');
  });

  it('preserves alternating HIGH/LOW pattern', async () => {
    const response = await loadFixture();
    const { events } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.type).not.toBe(events[i - 1]!.type);
    }
  });

  it('source record carries station id and datum', async () => {
    const response = await loadFixture();
    const { source } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    expect(source.stationId).toBe(STATION_ID);
    expect(source.datum).toBe(DATUM);
  });

  it('source provider string includes station id', async () => {
    const response = await loadFixture();
    const { source } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    expect(source.provider).toContain(STATION_ID);
  });

  it('source retrievedAt matches the supplied timestamp', async () => {
    const response = await loadFixture();
    const { source } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    expect(source.retrievedAt).toBe(new Date(RETRIEVED_AT_MS).toISOString());
  });

  it('validFrom matches the first event time', async () => {
    const response = await loadFixture();
    const { events, source } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    expect(source.validFrom).toBe(new Date(events[0]!.timeUtcMs).toISOString());
  });

  it('validTo matches the last event time', async () => {
    const response = await loadFixture();
    const { events, source } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    expect(source.validTo).toBe(new Date(events[events.length - 1]!.timeUtcMs).toISOString());
  });

  it('attribution references NOAA', async () => {
    const response = await loadFixture();
    const { source } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    expect(source.attribution).toMatch(/NOAA/i);
  });
});

// ─── Unit tests for edge cases ────────────────────────────────────────────────

describe('parseTidePredictions — edge cases', () => {
  it('returns empty events and null validity when predictions is empty', () => {
    const response: NoaaTideResponse = { predictions: [] };
    const result = parseTidePredictions(response, STATION_ID, STATION_NAME, DATUM, RETRIEVED_AT_MS);
    expect(result.events).toHaveLength(0);
    expect(result.source.validFrom).toBeNull();
    expect(result.source.validTo).toBeNull();
  });

  it('throws when a time string is not parseable', () => {
    const response: NoaaTideResponse = {
      predictions: [{ t: 'not-a-date', v: '1.0', type: 'L' }],
    };
    expect(() =>
      parseTidePredictions(response, STATION_ID, STATION_NAME, DATUM, RETRIEVED_AT_MS),
    ).toThrow('unparseable time');
  });

  it('throws when a height value is not numeric', () => {
    const response: NoaaTideResponse = {
      predictions: [{ t: '2026-07-25 08:47', v: 'bad', type: 'L' }],
    };
    expect(() =>
      parseTidePredictions(response, STATION_ID, STATION_NAME, DATUM, RETRIEVED_AT_MS),
    ).toThrow('unparseable height');
  });

  it('sorts events into ascending order even if input is unordered', () => {
    const response: NoaaTideResponse = {
      predictions: [
        { t: '2026-07-25 15:03', v: '2.340', type: 'H' },
        { t: '2026-07-25 08:47', v: '0.398', type: 'L' },
      ],
    };
    const { events } = parseTidePredictions(
      response,
      STATION_ID,
      STATION_NAME,
      DATUM,
      RETRIEVED_AT_MS,
    );
    expect(events[0]!.type).toBe('LOW');
    expect(events[1]!.type).toBe('HIGH');
  });
});
