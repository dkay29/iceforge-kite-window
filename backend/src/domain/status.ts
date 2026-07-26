/**
 * Recommendation status semantics.
 *
 * See docs/status-semantics.md for full definitions and threshold behavior.
 */

/**
 * Overall recommendation for a session window or a daily summary.
 *
 * - GO:        All hard rules pass and the suitability score is ≥ 70.
 * - MARGINAL:  All hard rules pass and the suitability score is 40–69 (inclusive).
 * - NO_GO:     At least one hard rule fails. Score is irrelevant.
 * - UNKNOWN:   Insufficient or too-stale data to evaluate any hard rule.
 *              Data gaps that prevent a safety determination produce UNKNOWN,
 *              not NO_GO, so the two states are distinguishable.
 */
export type RecommendationStatus = 'GO' | 'MARGINAL' | 'NO_GO' | 'UNKNOWN';

export interface StatusThresholds {
  /** Score must be ≥ this value to receive GO. */
  goMinScore: number;
  /** Score must be ≥ this value to receive MARGINAL (and < goMinScore). */
  marginalMinScore: number;
}

/**
 * Thresholds used to derive RecommendationStatus from a numeric score.
 * These are the canonical values; the ruleset may override them per-spot.
 */
export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = {
  goMinScore: 70,
  marginalMinScore: 40,
};

/**
 * Derive a RecommendationStatus from a hard-rule result and a numeric score.
 *
 * @param hardRulesPassed - false when any configured hard rule fails
 * @param score           - suitability score 0–100, or null when data is insufficient
 * @param thresholds      - optional override of default thresholds
 */
export function deriveStatus(
  hardRulesPassed: boolean,
  score: number | null,
  thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS,
): RecommendationStatus {
  if (score === null) return 'UNKNOWN';
  if (!hardRulesPassed) return 'NO_GO';
  if (score >= thresholds.goMinScore) return 'GO';
  if (score >= thresholds.marginalMinScore) return 'MARGINAL';
  return 'NO_GO';
}

/**
 * Return true when a status represents a safe, publishable session recommendation.
 */
export function isPositiveStatus(status: RecommendationStatus): boolean {
  return status === 'GO' || status === 'MARGINAL';
}

/**
 * Return a human-readable label for display in UI and logs.
 */
export function statusLabel(status: RecommendationStatus): string {
  switch (status) {
    case 'GO':
      return 'Go';
    case 'MARGINAL':
      return 'Marginal';
    case 'NO_GO':
      return 'No Go';
    case 'UNKNOWN':
      return 'Unknown';
  }
}
