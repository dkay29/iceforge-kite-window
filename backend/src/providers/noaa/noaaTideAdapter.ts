/**
 * NOAA CO-OPS tide adapter.
 *
 * Parses raw NOAA hi-lo predictions (requested with time_zone=gmt) into typed
 * domain tide events. Preserves attribution, retrieval time, station, datum,
 * and source validity window.
 */

import type { NoaaTideResponse } from '../types.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export type TideEventType = 'HIGH' | 'LOW';

export interface TideEvent {
  /** UTC milliseconds since Unix epoch. */
  timeUtcMs: number;
  /** Tide height in feet (MLLW or as requested). */
  heightFeet: number;
  /** High or low tide. */
  type: TideEventType;
}

export interface TideSourceRecord {
  provider: string;
  stationId: string;
  stationName: string;
  datum: string;
  /** ISO 8601 UTC timestamp when the data was fetched. */
  retrievedAt: string;
  /** ISO 8601 UTC timestamp of the first prediction in the response. */
  validFrom: string | null;
  /** ISO 8601 UTC timestamp of the last prediction in the response. */
  validTo: string | null;
  attribution: string;
}

export interface TideFetchResult {
  events: TideEvent[];
  source: TideSourceRecord;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse a raw NOAA GMT hi-lo response into typed domain tide events.
 *
 * The NOAA `t` field must be in `"YYYY-MM-DD HH:mm"` format representing
 * UTC (i.e. the API was called with `time_zone=gmt`).
 *
 * @param response     - Raw validated NOAA response.
 * @param stationId    - NOAA CO-OPS station identifier.
 * @param stationName  - Human-readable station name for attribution.
 * @param datum        - Tidal datum (e.g. 'MLLW').
 * @param retrievedAtMs - UTC ms when the data was retrieved.
 * @throws {Error} if a prediction has an unparseable time or height.
 */
export function parseTidePredictions(
  response: NoaaTideResponse,
  stationId: string,
  stationName: string,
  datum: string,
  retrievedAtMs: number,
): TideFetchResult {
  const events: TideEvent[] = response.predictions.map((p, i) => {
    const timeUtcMs = parseGmtTime(p.t, i);
    const heightFeet = parseHeight(p.v, i);
    const type: TideEventType = p.type === 'H' ? 'HIGH' : 'LOW';
    return { timeUtcMs, heightFeet, type };
  });

  // Sort ascending by time (NOAA already returns chronological order, but be safe)
  events.sort((a, b) => a.timeUtcMs - b.timeUtcMs);

  const validFrom = events.length > 0 ? new Date(events[0]!.timeUtcMs).toISOString() : null;
  const validTo =
    events.length > 0 ? new Date(events[events.length - 1]!.timeUtcMs).toISOString() : null;

  const source: TideSourceRecord = {
    provider: `NOAA CO-OPS ${stationId}`,
    stationId,
    stationName,
    datum,
    retrievedAt: new Date(retrievedAtMs).toISOString(),
    validFrom,
    validTo,
    attribution: 'NOAA Center for Operational Oceanographic Products and Services',
  };

  return { events, source };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse `"YYYY-MM-DD HH:mm"` in GMT to UTC milliseconds.
 */
function parseGmtTime(t: string, index: number): number {
  // Strict format check before parsing.
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) {
    throw new Error(`NOAA prediction[${index}]: unparseable time "${t}"`);
  }
  const isoStr = t.replace(' ', 'T') + ':00Z';
  const ms = Date.parse(isoStr);
  if (Number.isNaN(ms)) {
    throw new Error(`NOAA prediction[${index}]: unparseable time "${t}"`);
  }
  return ms;
}

/**
 * Parse the height string (e.g. "0.398") to a number.
 */
function parseHeight(v: string, index: number): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) {
    throw new Error(`NOAA prediction[${index}]: unparseable height "${v}"`);
  }
  return n;
}
