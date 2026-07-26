/**
 * Candidate session-window generation.
 *
 * Generates three-hour windows around each low tide and filters them against
 * hard constraints. See docs/candidate-windows.md for the full specification.
 *
 * All times are represented as UTC milliseconds (Unix epoch ms) internally.
 * Window display times are formatted in the spot's IANA timezone.
 */

export const WINDOW_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours
export const SLOT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * A low-tide event used as an anchor for candidate windows.
 */
export interface LowTideEvent {
  /** UTC ms of the low-tide time. */
  timeUtcMs: number;
  /** Tide height in feet (MLLW). */
  heightFeet: number;
}

/**
 * A candidate three-hour session window.
 * startUtcMs is inclusive, endUtcMs is exclusive (half-open interval).
 */
export interface CandidateWindow {
  /** Inclusive start of the window (UTC ms). */
  startUtcMs: number;
  /** Exclusive end of the window (UTC ms). startUtcMs + WINDOW_DURATION_MS. */
  endUtcMs: number;
  /** The low-tide event this window is anchored to. */
  lowTide: LowTideEvent;
  /** Index of this window in the generation pass, used for stable ordering. */
  generationIndex: number;
}

/**
 * Generate all candidate windows centered on the given low-tide events.
 *
 * Generation algorithm:
 *   For each low tide L, the candidate window is:
 *     start = L.timeUtcMs - WINDOW_DURATION_MS / 2   (1.5 h before low tide)
 *     end   = start + WINDOW_DURATION_MS              (3 h later)
 *
 * The window is centered on the low tide. This guarantees the low tide falls
 * within the window whenever the window is valid (and is exact when tide timing
 * places the low tide at the midpoint).
 *
 * The low tide must fall within [start, end) for the window to be valid.
 * Because the window is exactly centered, the low tide always falls at the
 * midpoint — i.e., at start + WINDOW_DURATION_MS/2 — which is within [start, end).
 *
 * @param lowTides     - Sorted (ascending) low-tide events
 * @param horizonStart - Earliest UTC ms allowed for a window start
 * @param horizonEnd   - Latest UTC ms allowed for a window end (exclusive)
 */
export function generateCandidateWindows(
  lowTides: LowTideEvent[],
  horizonStart: number,
  horizonEnd: number,
): CandidateWindow[] {
  const windows: CandidateWindow[] = [];
  let index = 0;

  for (const tide of lowTides) {
    const halfDuration = WINDOW_DURATION_MS / 2;
    const start = tide.timeUtcMs - halfDuration;
    const end = start + WINDOW_DURATION_MS;

    // Skip if the window falls completely outside the forecast horizon
    if (end <= horizonStart || start >= horizonEnd) continue;

    // Clamp to horizon — but only include if the low tide still falls within
    const clampedStart = Math.max(start, horizonStart);
    const clampedEnd = Math.min(end, horizonEnd);
    if (clampedEnd - clampedStart < WINDOW_DURATION_MS) continue; // window too short after clamping
    if (tide.timeUtcMs < clampedStart || tide.timeUtcMs >= clampedEnd) continue;

    windows.push({
      startUtcMs: start,
      endUtcMs: end,
      lowTide: tide,
      generationIndex: index++,
    });
  }

  return windows;
}

/**
 * Return true when a low-tide event is contained within a half-open window.
 * Low tide time must be in [startUtcMs, endUtcMs).
 */
export function lowTideInWindow(window: CandidateWindow): boolean {
  return (
    window.lowTide.timeUtcMs >= window.startUtcMs && window.lowTide.timeUtcMs < window.endUtcMs
  );
}

/**
 * Scored window, produced after hard-constraint and scoring passes.
 */
export interface ScoredWindow extends CandidateWindow {
  score: number; // 0–100
  weakestSlotScore: number; // score of the worst 15-min slot in the window
}

/**
 * Select the best window from a list of scored windows using deterministic
 * tie-breaking.
 *
 * Ranking order (primary → tertiary):
 *   1. Highest score (descending)
 *   2. Highest weakestSlotScore (descending) — safety-first tie-break
 *   3. Earliest startUtcMs (ascending) — prefer earlier window on equal quality
 *
 * @param windows - Non-empty array of scored windows (all have passed hard rules)
 * @returns The best window
 */
export function selectBestWindow(windows: ScoredWindow[]): ScoredWindow {
  if (windows.length === 0) throw new Error('selectBestWindow requires at least one window');

  return [...windows].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.weakestSlotScore !== a.weakestSlotScore) return b.weakestSlotScore - a.weakestSlotScore;
    return a.startUtcMs - b.startUtcMs;
  })[0]!;
}

/**
 * Return the 96 UTC-aligned 15-minute slot start times (UTC ms) that fall
 * within the half-open window [startUtcMs, endUtcMs).
 */
export function windowSlots(window: CandidateWindow): number[] {
  const slots: number[] = [];
  // Round up startUtcMs to the next 15-minute boundary
  const firstSlot = Math.ceil(window.startUtcMs / SLOT_DURATION_MS) * SLOT_DURATION_MS;
  for (let t = firstSlot; t < window.endUtcMs; t += SLOT_DURATION_MS) {
    slots.push(t);
  }
  return slots;
}
