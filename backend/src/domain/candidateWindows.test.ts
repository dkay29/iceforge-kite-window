import { describe, expect, it } from 'vitest';
import type { CandidateWindow, LowTideEvent, ScoredWindow } from './candidateWindows.js';
import {
  SLOT_DURATION_MS,
  WINDOW_DURATION_MS,
  generateCandidateWindows,
  lowTideInWindow,
  selectBestWindow,
  windowSlots,
} from './candidateWindows.js';

// Helpers
const ms = (isoString: string) => new Date(isoString).getTime();
const HORIZON_START = ms('2026-07-26T00:00:00Z');
const HORIZON_END = ms('2026-07-27T00:00:00Z');

function makeLowTide(isoString: string, heightFeet = 0.4): LowTideEvent {
  return { timeUtcMs: ms(isoString), heightFeet };
}

function makeWindow(start: string, lowTideIso: string, index = 0): CandidateWindow {
  const startMs = ms(start);
  return {
    startUtcMs: startMs,
    endUtcMs: startMs + WINDOW_DURATION_MS,
    lowTide: makeLowTide(lowTideIso),
    generationIndex: index,
  };
}

function makeScoredWindow(
  start: string,
  lowTideIso: string,
  score: number,
  weakestSlotScore: number,
  index = 0,
): ScoredWindow {
  return { ...makeWindow(start, lowTideIso, index), score, weakestSlotScore };
}

describe('generateCandidateWindows', () => {
  it('generates a centered 3-hour window for a single low tide', () => {
    const tide = makeLowTide('2026-07-26T08:47:00Z'); // low tide mid-morning UTC
    const windows = generateCandidateWindows([tide], HORIZON_START, HORIZON_END);
    expect(windows).toHaveLength(1);
    const w = windows[0]!;
    // Window should be centered on the low tide
    expect(w.startUtcMs).toBe(ms('2026-07-26T07:17:00Z')); // 08:47 - 1:30
    expect(w.endUtcMs).toBe(ms('2026-07-26T10:17:00Z')); // 08:47 + 1:30
    expect(w.endUtcMs - w.startUtcMs).toBe(WINDOW_DURATION_MS);
    expect(w.lowTide.timeUtcMs).toBe(tide.timeUtcMs);
  });

  it('generates windows for each low tide in a day', () => {
    // Nantucket Sound has two low tides per day
    const tides = [makeLowTide('2026-07-26T04:47:00Z'), makeLowTide('2026-07-26T16:46:00Z')];
    const windows = generateCandidateWindows(tides, HORIZON_START, HORIZON_END);
    expect(windows).toHaveLength(2);
  });

  it('assigns ascending generation indices', () => {
    const tides = [makeLowTide('2026-07-26T04:00:00Z'), makeLowTide('2026-07-26T16:00:00Z')];
    const windows = generateCandidateWindows(tides, HORIZON_START, HORIZON_END);
    expect(windows[0]!.generationIndex).toBe(0);
    expect(windows[1]!.generationIndex).toBe(1);
  });

  it('skips a window when the entire window falls outside the horizon', () => {
    // Low tide at 23:30 UTC → window 22:00–01:00 UTC (extends past midnight)
    const tide = makeLowTide('2026-07-26T23:30:00Z');
    const windows = generateCandidateWindows([tide], HORIZON_START, HORIZON_END);
    // Window end (01:00 on 27th) exceeds horizonEnd — window is too short after clamping
    expect(windows).toHaveLength(0);
  });

  it('skips a window when start is before horizonStart and low tide falls outside clamped range', () => {
    // Low tide at 00:30 → window 23:00 (prev day) – 02:30
    // Clamped: 00:00–02:30 = 2.5 h, too short
    const tide = makeLowTide('2026-07-26T01:00:00Z');
    const windows = generateCandidateWindows([tide], HORIZON_START, HORIZON_END);
    expect(windows).toHaveLength(0);
  });

  it('includes a window when the low tide is well within the horizon', () => {
    const tide = makeLowTide('2026-07-26T12:00:00Z');
    const windows = generateCandidateWindows([tide], HORIZON_START, HORIZON_END);
    expect(windows).toHaveLength(1);
  });

  it('returns an empty array when there are no low tides', () => {
    expect(generateCandidateWindows([], HORIZON_START, HORIZON_END)).toEqual([]);
  });

  it('handles multiple days of low tides in a multi-day horizon', () => {
    const twoDay = ms('2026-07-28T00:00:00Z');
    const tides = [
      makeLowTide('2026-07-26T04:47:00Z'),
      makeLowTide('2026-07-26T16:46:00Z'),
      makeLowTide('2026-07-27T05:39:00Z'),
      makeLowTide('2026-07-27T17:36:00Z'),
    ];
    const windows = generateCandidateWindows(tides, HORIZON_START, twoDay);
    expect(windows).toHaveLength(4);
  });
});

describe('lowTideInWindow', () => {
  it('returns true when low tide is within the half-open window', () => {
    const w = makeWindow('2026-07-26T07:17:00Z', '2026-07-26T08:47:00Z');
    expect(lowTideInWindow(w)).toBe(true);
  });

  it('returns true when low tide is at the start of the window (inclusive)', () => {
    const startIso = '2026-07-26T08:00:00Z';
    const w: CandidateWindow = {
      startUtcMs: ms(startIso),
      endUtcMs: ms(startIso) + WINDOW_DURATION_MS,
      lowTide: makeLowTide(startIso),
      generationIndex: 0,
    };
    expect(lowTideInWindow(w)).toBe(true);
  });

  it('returns false when low tide is exactly at the end of the window (exclusive)', () => {
    const startIso = '2026-07-26T08:00:00Z';
    const endIso = '2026-07-26T11:00:00Z';
    const w: CandidateWindow = {
      startUtcMs: ms(startIso),
      endUtcMs: ms(endIso),
      lowTide: makeLowTide(endIso),
      generationIndex: 0,
    };
    expect(lowTideInWindow(w)).toBe(false);
  });

  it('returns false when low tide is before the window', () => {
    const w = makeWindow('2026-07-26T10:00:00Z', '2026-07-26T09:00:00Z');
    expect(lowTideInWindow(w)).toBe(false);
  });
});

describe('selectBestWindow — tie-breaking', () => {
  it('selects the window with the highest score', () => {
    const windows = [
      makeScoredWindow('2026-07-26T07:00:00Z', '2026-07-26T08:30:00Z', 60, 50, 0),
      makeScoredWindow('2026-07-26T14:00:00Z', '2026-07-26T15:30:00Z', 80, 70, 1),
    ];
    expect(selectBestWindow(windows).score).toBe(80);
  });

  it('breaks score tie by highest weakestSlotScore', () => {
    const windows = [
      makeScoredWindow('2026-07-26T07:00:00Z', '2026-07-26T08:30:00Z', 75, 50, 0),
      makeScoredWindow('2026-07-26T14:00:00Z', '2026-07-26T15:30:00Z', 75, 70, 1),
    ];
    const best = selectBestWindow(windows);
    expect(best.weakestSlotScore).toBe(70);
    expect(best.startUtcMs).toBe(ms('2026-07-26T14:00:00Z'));
  });

  it('breaks score+weakest tie by earliest startUtcMs', () => {
    const windows = [
      makeScoredWindow('2026-07-26T14:00:00Z', '2026-07-26T15:30:00Z', 75, 60, 1),
      makeScoredWindow('2026-07-26T07:00:00Z', '2026-07-26T08:30:00Z', 75, 60, 0),
    ];
    const best = selectBestWindow(windows);
    expect(best.startUtcMs).toBe(ms('2026-07-26T07:00:00Z'));
  });

  it('throws when given an empty array', () => {
    expect(() => selectBestWindow([])).toThrow();
  });

  it('works with a single window', () => {
    const windows = [makeScoredWindow('2026-07-26T07:00:00Z', '2026-07-26T08:30:00Z', 82, 65, 0)];
    expect(selectBestWindow(windows).score).toBe(82);
  });
});

describe('windowSlots', () => {
  it('returns 12 slots for a 3-hour window aligned to 15-minute boundaries', () => {
    // Window exactly aligned: 09:00–12:00
    const w = makeWindow('2026-07-26T09:00:00Z', '2026-07-26T10:30:00Z');
    const slots = windowSlots(w);
    expect(slots).toHaveLength(12);
    expect(slots[0]).toBe(ms('2026-07-26T09:00:00Z'));
    expect(slots[11]).toBe(ms('2026-07-26T11:45:00Z'));
  });

  it('aligns to next 15-minute boundary when window start is not aligned', () => {
    // Window starts at 09:02 — first slot should be 09:15
    const startMs = ms('2026-07-26T09:02:00Z');
    const w: CandidateWindow = {
      startUtcMs: startMs,
      endUtcMs: startMs + WINDOW_DURATION_MS,
      lowTide: makeLowTide('2026-07-26T10:32:00Z'),
      generationIndex: 0,
    };
    const slots = windowSlots(w);
    expect(slots[0]).toBe(ms('2026-07-26T09:15:00Z'));
  });

  it('slots are separated by SLOT_DURATION_MS', () => {
    const w = makeWindow('2026-07-26T09:00:00Z', '2026-07-26T10:30:00Z');
    const slots = windowSlots(w);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]! - slots[i - 1]!).toBe(SLOT_DURATION_MS);
    }
  });
});
