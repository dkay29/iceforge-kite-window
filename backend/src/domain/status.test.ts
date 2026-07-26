import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_THRESHOLDS,
  deriveStatus,
  isPositiveStatus,
  statusLabel,
} from './status.js';

describe('deriveStatus', () => {
  const t = DEFAULT_STATUS_THRESHOLDS;

  // --- UNKNOWN: score is null ---
  it('returns UNKNOWN when score is null, regardless of hard rules', () => {
    expect(deriveStatus(true, null)).toBe('UNKNOWN');
    expect(deriveStatus(false, null)).toBe('UNKNOWN');
  });

  // --- NO_GO: hard rule failed (score is available) ---
  it('returns NO_GO when a hard rule fails even if score is high', () => {
    expect(deriveStatus(false, 100)).toBe('NO_GO');
    expect(deriveStatus(false, 70)).toBe('NO_GO');
    expect(deriveStatus(false, 0)).toBe('NO_GO');
  });

  // --- GO: hard rules pass, score ≥ goMinScore ---
  it('returns GO when score equals goMinScore boundary (70)', () => {
    expect(deriveStatus(true, t.goMinScore)).toBe('GO');
  });

  it('returns GO when score exceeds goMinScore', () => {
    expect(deriveStatus(true, 100)).toBe('GO');
    expect(deriveStatus(true, 71)).toBe('GO');
  });

  // --- MARGINAL: hard rules pass, marginalMinScore ≤ score < goMinScore ---
  it('returns MARGINAL at the marginalMinScore boundary (40)', () => {
    expect(deriveStatus(true, t.marginalMinScore)).toBe('MARGINAL');
  });

  it('returns MARGINAL just below goMinScore (69)', () => {
    expect(deriveStatus(true, t.goMinScore - 1)).toBe('MARGINAL');
  });

  it('returns MARGINAL for scores in the middle range', () => {
    expect(deriveStatus(true, 55)).toBe('MARGINAL');
  });

  // --- NO_GO: hard rules pass but score < marginalMinScore ---
  it('returns NO_GO when score is below marginalMinScore (39)', () => {
    expect(deriveStatus(true, t.marginalMinScore - 1)).toBe('NO_GO');
  });

  it('returns NO_GO when score is 0 and hard rules pass', () => {
    expect(deriveStatus(true, 0)).toBe('NO_GO');
  });

  // --- Threshold override ---
  it('respects custom threshold overrides', () => {
    const custom = { goMinScore: 80, marginalMinScore: 60 };
    expect(deriveStatus(true, 79, custom)).toBe('MARGINAL');
    expect(deriveStatus(true, 80, custom)).toBe('GO');
    expect(deriveStatus(true, 59, custom)).toBe('NO_GO');
    expect(deriveStatus(true, 60, custom)).toBe('MARGINAL');
  });

  // --- UNKNOWN vs NO_GO are distinct ---
  it('UNKNOWN is distinct from NO_GO — hard-rule failure gives NO_GO, not UNKNOWN', () => {
    expect(deriveStatus(false, 50)).toBe('NO_GO');
    expect(deriveStatus(true, null)).toBe('UNKNOWN');
    expect(deriveStatus(false, 50)).not.toBe('UNKNOWN');
    expect(deriveStatus(true, null)).not.toBe('NO_GO');
  });
});

describe('isPositiveStatus', () => {
  it('returns true for GO', () => expect(isPositiveStatus('GO')).toBe(true));
  it('returns true for MARGINAL', () => expect(isPositiveStatus('MARGINAL')).toBe(true));
  it('returns false for NO_GO', () => expect(isPositiveStatus('NO_GO')).toBe(false));
  it('returns false for UNKNOWN', () => expect(isPositiveStatus('UNKNOWN')).toBe(false));
});

describe('statusLabel', () => {
  it('returns "Go" for GO', () => expect(statusLabel('GO')).toBe('Go'));
  it('returns "Marginal" for MARGINAL', () => expect(statusLabel('MARGINAL')).toBe('Marginal'));
  it('returns "No Go" for NO_GO', () => expect(statusLabel('NO_GO')).toBe('No Go'));
  it('returns "Unknown" for UNKNOWN', () => expect(statusLabel('UNKNOWN')).toBe('Unknown'));
});
