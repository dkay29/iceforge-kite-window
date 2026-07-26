/**
 * Interpolation and stale-data policies.
 *
 * See docs/units-and-time.md for unit conventions.
 * See docs/interpolation-policy.md for full per-field specifications.
 */

import { normalizeDegrees } from './windDirection.js';

/**
 * Data source tags used on each timeline point.
 * OBSERVED   — from a live sensor or completed observation
 * FORECAST   — from a model/forecast product
 * INTERPOLATED — synthetically computed from surrounding real values
 * CALCULATED — deterministically computed (e.g. solar events)
 * MISSING    — no data available; value is null
 */
export type DataSource = 'OBSERVED' | 'FORECAST' | 'INTERPOLATED' | 'CALCULATED' | 'MISSING';

/**
 * Maximum interpolation gaps per field.
 * If the gap between surrounding real values exceeds the limit, the field is
 * MISSING for all intermediate points rather than interpolated.
 */
export const MAX_INTERPOLATION_GAP_MS: Readonly<Record<string, number>> = {
  windSpeedKnots: 3 * 60 * 60 * 1000, // 3 hours
  windDirectionDegrees: 3 * 60 * 60 * 1000,
  gustSpeedKnots: 3 * 60 * 60 * 1000,
  tideHeightFeet: 6 * 60 * 60 * 1000, // 6 hours (interpolated from hi-lo)
  temperatureCelsius: 6 * 60 * 60 * 1000,
  probabilityOfPrecipitation: 6 * 60 * 60 * 1000,
  probabilityOfThunder: 6 * 60 * 60 * 1000,
} as const;

/**
 * Staleness thresholds: a retrieved dataset older than this is considered stale
 * and must not be used without flagging.
 */
export const STALENESS_THRESHOLD_MS: Readonly<Record<string, number>> = {
  nwsForecast: 2 * 60 * 60 * 1000, // NWS forecasts are updated ~hourly; 2 h limit
  noaaTidePredictions: 24 * 60 * 60 * 1000, // Tide predictions change rarely; 24 h limit
} as const;

/**
 * Linear interpolation between two scalar values.
 *
 * @param a      - Value at the earlier time
 * @param b      - Value at the later time
 * @param t      - Fraction of the way from a to b, in [0, 1]
 */
export function linearInterpolate(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Circular (angular) interpolation between two wind directions.
 *
 * Takes the shortest arc from `a` to `b` on the circle. If the arc is
 * exactly 180° (ambiguous), interpolates in the clockwise direction.
 *
 * @param aDegrees - Start direction in degrees [0, 360)
 * @param bDegrees - End direction in degrees [0, 360)
 * @param t        - Fraction in [0, 1]
 * @returns Interpolated direction in [0, 360)
 */
export function circularInterpolate(aDegrees: number, bDegrees: number, t: number): number {
  const a = normalizeDegrees(aDegrees);
  const b = normalizeDegrees(bDegrees);
  let delta = normalizeDegrees(b - a); // 0–360
  if (delta > 180) delta -= 360; // shortest arc: -180 to +180
  return normalizeDegrees(a + delta * t);
}

/**
 * Conservative hazard interpolation: for boolean-like hazard fields
 * (e.g. probabilityOfThunder), take the MAXIMUM of the two bounding values
 * rather than linear interpolation. This ensures a gap containing a hazard
 * event is never understated.
 *
 * @param a - Value at the earlier time
 * @param b - Value at the later time
 */
export function conservativeHazardInterpolate(a: number, b: number): number {
  return Math.max(a, b);
}

/**
 * Interpolate a sequence of scalar values to fill gaps up to maxGapMs.
 *
 * @param points   - Sparse array of {timeMs, value} pairs, sorted ascending by timeMs
 * @param slotTimes - Array of UTC ms timestamps to interpolate to
 * @param maxGapMs - Maximum gap to interpolate across; larger gaps produce null
 * @param interpolateFn - Interpolation function; defaults to linear
 * @returns Array of (number | null) aligned to slotTimes
 */
export function interpolateScalar(
  points: Array<{ timeMs: number; value: number }>,
  slotTimes: number[],
  maxGapMs: number,
  interpolateFn: (a: number, b: number, t: number) => number = linearInterpolate,
): Array<number | null> {
  return slotTimes.map((slotMs) => {
    // Find surrounding points
    let lo: (typeof points)[0] | undefined;
    let hi: (typeof points)[0] | undefined;
    for (const p of points) {
      if (p.timeMs <= slotMs) lo = p;
      else if (hi === undefined) hi = p;
    }

    if (lo === undefined && hi === undefined) return null;
    if (lo !== undefined && lo.timeMs === slotMs) return lo.value;
    if (lo === undefined) return null; // slot is before all data
    if (hi === undefined) return null; // slot is after all data

    const gap = hi.timeMs - lo.timeMs;
    if (gap > maxGapMs) return null;

    const t = (slotMs - lo.timeMs) / gap;
    return interpolateFn(lo.value, hi.value, t);
  });
}

/**
 * Determine whether a dataset is stale given its retrieval time.
 *
 * @param retrievedAtMs  - UTC ms when the data was fetched
 * @param nowMs          - Current UTC ms
 * @param maxAgeMs       - Maximum acceptable age in ms
 */
export function isStale(retrievedAtMs: number, nowMs: number, maxAgeMs: number): boolean {
  return nowMs - retrievedAtMs > maxAgeMs;
}
