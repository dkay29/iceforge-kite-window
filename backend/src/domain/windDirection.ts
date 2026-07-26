/**
 * Wind-direction classification module.
 *
 * All angles are in degrees true, meteorological FROM convention:
 *   0° = wind from north, 90° = wind from east, etc.
 *
 * Classification is relative to the spot's seawardBearingDegrees.
 * See docs/shore-bearing.md for full semantics and worked examples.
 */

export type WindClassification =
  'DIRECT_ONSHORE' | 'SIDE_ONSHORE' | 'CROSS_SHORE' | 'SIDE_OFFSHORE' | 'OFFSHORE';

/**
 * Normalize any angle to [0, 360).
 * Handles negative values and values ≥ 360.
 */
export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Compute the absolute circular angular difference between two bearings.
 * Returns a value in [0, 180].
 *
 * @param a - First angle in degrees (any value, will be normalized)
 * @param b - Second angle in degrees (any value, will be normalized)
 */
export function circularAbsDiff(a: number, b: number): number {
  const diff = normalizeDegrees(a - b);
  return diff <= 180 ? diff : 360 - diff;
}

/**
 * Classify a wind direction relative to the spot's seaward bearing.
 *
 * Classification thresholds (absolute angular difference φ from seaward bearing):
 *   φ ∈ [0°, 30°]    → DIRECT_ONSHORE
 *   φ ∈ (30°, 75°]   → SIDE_ONSHORE
 *   φ ∈ (75°, 90°]   → CROSS_SHORE
 *   φ ∈ (90°, 135°]  → SIDE_OFFSHORE
 *   φ ∈ (135°, 180°] → OFFSHORE
 *
 * @param windFromDegrees    - Meteorological FROM-direction of the wind (degrees true)
 * @param seawardBearingDeg  - The spot's seaward bearing (degrees true)
 * @returns WindClassification
 */
export function classifyWindDirection(
  windFromDegrees: number,
  seawardBearingDeg: number,
): WindClassification {
  const phi = circularAbsDiff(windFromDegrees, seawardBearingDeg);
  if (phi <= 30) return 'DIRECT_ONSHORE';
  if (phi <= 75) return 'SIDE_ONSHORE';
  if (phi <= 90) return 'CROSS_SHORE';
  if (phi <= 135) return 'SIDE_OFFSHORE';
  return 'OFFSHORE';
}

/**
 * Return true when the classification is accepted for kite-surfing at this spot.
 * Only DIRECT_ONSHORE and SIDE_ONSHORE are accepted.
 */
export function isAcceptedClassification(classification: WindClassification): boolean {
  return classification === 'DIRECT_ONSHORE' || classification === 'SIDE_ONSHORE';
}

/**
 * Convenience: classify AND check acceptance in one call.
 *
 * @param windFromDegrees   - Meteorological FROM-direction of the wind (degrees true)
 * @param seawardBearingDeg - The spot's seaward bearing (degrees true)
 * @returns Object with classification and accepted flag
 */
export function classifyWind(
  windFromDegrees: number,
  seawardBearingDeg: number,
): { classification: WindClassification; accepted: boolean } {
  const classification = classifyWindDirection(windFromDegrees, seawardBearingDeg);
  return { classification, accepted: isAcceptedClassification(classification) };
}
