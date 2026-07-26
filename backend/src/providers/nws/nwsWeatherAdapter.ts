/**
 * NWS grid-data weather adapter.
 *
 * Parses raw NWS gridpoints/{office}/{x},{y} responses into typed domain
 * intervals with unit conversions. Preserves attribution, retrieval time,
 * and update/validity timestamps.
 *
 * NWS grid values are expressed as ISO 8601 interval pairs:
 *   "2026-07-26T05:00:00+00:00/PT4H"
 * meaning the value applies from the start timestamp through the end of
 * the duration.  Each interval is modelled as a half-open [start, end).
 */

import type { NwsGridDataResponse } from '../types.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface NwsTimeInterval {
  /** Inclusive interval start in UTC ms. */
  startUtcMs: number;
  /** Exclusive interval end in UTC ms. */
  endUtcMs: number;
  value: number | null;
}

export interface NwsWeatherData {
  /** Meteorological FROM-direction, degrees true. */
  windDirectionIntervals: NwsTimeInterval[];
  /** Wind speed in knots (converted from km/h). */
  windSpeedKnotsIntervals: NwsTimeInterval[];
  /** Gust speed in knots (converted from km/h). */
  windGustKnotsIntervals: NwsTimeInterval[];
  /** Sky cover percentage 0–100. */
  skyCoverPercentIntervals: NwsTimeInterval[];
  /** Probability of precipitation 0–100. */
  precipProbabilityIntervals: NwsTimeInterval[];
  /** Probability of thunder 0–100. */
  thunderProbabilityIntervals: NwsTimeInterval[];
  /** Temperature in °C. */
  temperatureCelsiusIntervals: NwsTimeInterval[];
  source: NwsWeatherSourceRecord;
}

export interface NwsWeatherSourceRecord {
  provider: string;
  office: string;
  /** ISO 8601 UTC timestamp when the data was fetched. */
  retrievedAt: string;
  /** ISO 8601 UTC timestamp from the NWS updateTime field. */
  updateTime: string;
  /** ISO 8601 UTC timestamp of the first interval start. */
  validFrom: string | null;
  /** ISO 8601 UTC timestamp of the last interval end. */
  validTo: string | null;
  attribution: string;
}

// Unit conversions
const KMH_TO_KNOTS = 0.539957;

// ─── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Parse a raw NWS grid-data response into typed weather intervals.
 *
 * @param response      - Validated NWS grid data response.
 * @param office        - NWS office identifier (e.g. 'BOX').
 * @param retrievedAtMs - UTC ms when the data was fetched.
 */
export function parseNwsGridData(
  response: NwsGridDataResponse,
  office: string,
  retrievedAtMs: number,
): NwsWeatherData {
  const props = response.properties;

  const windDirection = parseIntervals(props.windDirection.values, null);
  const windSpeedKnots = parseIntervals(props.windSpeed.values, KMH_TO_KNOTS);
  const windGustKnots = parseIntervals(props.windGust.values, KMH_TO_KNOTS);
  const skyCover = parseIntervals(props.skyCover.values, null);
  const precipProbability = parseIntervals(props.probabilityOfPrecipitation.values, null);
  const thunderProbability = parseIntervals(props.probabilityOfThunder.values, null);
  const temperature = parseIntervals(props.temperature.values, null);

  // Collect all interval start/end times to determine validity range
  const allIntervals = [
    ...windDirection,
    ...windSpeedKnots,
    ...windGustKnots,
    ...skyCover,
    ...precipProbability,
    ...thunderProbability,
    ...temperature,
  ];
  const validFrom =
    allIntervals.length > 0
      ? new Date(Math.min(...allIntervals.map((i) => i.startUtcMs))).toISOString()
      : null;
  const validTo =
    allIntervals.length > 0
      ? new Date(Math.max(...allIntervals.map((i) => i.endUtcMs))).toISOString()
      : null;

  const source: NwsWeatherSourceRecord = {
    provider: `NWS ${office}`,
    office,
    retrievedAt: new Date(retrievedAtMs).toISOString(),
    updateTime: props.updateTime,
    validFrom,
    validTo,
    attribution: `National Weather Service, ${office}`,
  };

  return {
    windDirectionIntervals: windDirection,
    windSpeedKnotsIntervals: windSpeedKnots,
    windGustKnotsIntervals: windGustKnots,
    skyCoverPercentIntervals: skyCover,
    precipProbabilityIntervals: precipProbability,
    thunderProbabilityIntervals: thunderProbability,
    temperatureCelsiusIntervals: temperature,
    source,
  };
}

// ─── Interval parsing helpers ─────────────────────────────────────────────────

function parseIntervals(
  values: { validTime: string; value: number | null }[],
  conversionFactor: number | null,
): NwsTimeInterval[] {
  return values.map((entry, i) => {
    const { startMs, endMs } = parseValidTime(entry.validTime, i);
    const rawValue = entry.value;
    const value =
      rawValue === null ? null : conversionFactor !== null ? rawValue * conversionFactor : rawValue;
    return { startUtcMs: startMs, endUtcMs: endMs, value };
  });
}

/**
 * Parse an NWS ISO 8601 interval string "startTime/duration" to UTC ms bounds.
 *
 * Supported duration tokens: P, Y, M (month), W, D, T, H, M (minute), S.
 * NWS grid data uses a subset: PnDTnH, PTnH, PTnM.
 */
function parseValidTime(validTime: string, index: number): { startMs: number; endMs: number } {
  const slash = validTime.indexOf('/');
  if (slash === -1) {
    throw new Error(`NWS validTime[${index}]: missing duration separator in "${validTime}"`);
  }

  const startStr = validTime.slice(0, slash);
  const durationStr = validTime.slice(slash + 1);

  const startMs = Date.parse(startStr);
  if (Number.isNaN(startMs)) {
    throw new Error(`NWS validTime[${index}]: unparseable start "${startStr}"`);
  }

  const durationMs = parseIsoDurationMs(durationStr, index);
  return { startMs, endMs: startMs + durationMs };
}

/**
 * Parse an ISO 8601 duration string to milliseconds.
 * Handles: P[nY][nM][nW][nD][T[nH][nM][nS]]
 */
function parseIsoDurationMs(duration: string, index: number): number {
  const match = duration.match(
    /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) {
    throw new Error(`NWS validTime[${index}]: unrecognised duration "${duration}"`);
  }

  const [, years, months, weeks, days, hours, minutes, seconds] = match.map((v) =>
    v !== undefined ? parseFloat(v) : 0,
  );

  return (
    (years ?? 0) * 365.25 * 24 * 3600000 +
    (months ?? 0) * 30.4375 * 24 * 3600000 +
    (weeks ?? 0) * 7 * 24 * 3600000 +
    (days ?? 0) * 24 * 3600000 +
    (hours ?? 0) * 3600000 +
    (minutes ?? 0) * 60000 +
    (seconds ?? 0) * 1000
  );
}
