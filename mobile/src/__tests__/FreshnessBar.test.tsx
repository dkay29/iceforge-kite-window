/**
 * Tests for FreshnessBar freshness-state computation and formatting.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { FreshnessBar, computeFreshnessState, formatAge } from '../components/FreshnessBar';

// ─── computeFreshnessState ─────────────────────────────────────────────────────

const GENERATED_AT = '2026-07-26T18:00:00Z';
const EXPIRES_AT = '2026-07-26T22:00:00Z'; // 4 hours after generation
const EXPIRES_MS = new Date(EXPIRES_AT).getTime();

describe('computeFreshnessState', () => {
  it('returns "fresh" when well before expiry', () => {
    // 2 hours before expiry
    expect(computeFreshnessState(GENERATED_AT, EXPIRES_AT, EXPIRES_MS - 2 * 60 * 60 * 1000)).toBe(
      'fresh',
    );
  });

  it('returns "aging" within 30 min of expiry', () => {
    // 20 minutes before expiry
    expect(computeFreshnessState(GENERATED_AT, EXPIRES_AT, EXPIRES_MS - 20 * 60 * 1000)).toBe(
      'aging',
    );
  });

  it('returns "stale" at exactly expiry time', () => {
    expect(computeFreshnessState(GENERATED_AT, EXPIRES_AT, EXPIRES_MS)).toBe('stale');
  });

  it('returns "stale" after expiry', () => {
    expect(computeFreshnessState(GENERATED_AT, EXPIRES_AT, EXPIRES_MS + 60_000)).toBe('stale');
  });

  it('returns "offline" when offline and stale', () => {
    expect(computeFreshnessState(GENERATED_AT, EXPIRES_AT, EXPIRES_MS + 60_000, true)).toBe(
      'offline',
    );
  });

  it('returns "fresh" when offline but not yet stale', () => {
    // Offline but still within expiry window
    expect(
      computeFreshnessState(GENERATED_AT, EXPIRES_AT, EXPIRES_MS - 2 * 60 * 60 * 1000, true),
    ).toBe('fresh');
  });
});

// ─── formatAge ────────────────────────────────────────────────────────────────

const NOW_MS = new Date('2026-07-26T20:00:00Z').getTime();

describe('formatAge', () => {
  it('returns "just now" for less than 1 minute', () => {
    const genAt = new Date(NOW_MS - 30_000).toISOString();
    expect(formatAge(genAt, NOW_MS)).toBe('just now');
  });

  it('returns "1 min ago" for exactly 1 minute', () => {
    const genAt = new Date(NOW_MS - 60_000).toISOString();
    expect(formatAge(genAt, NOW_MS)).toBe('1 min ago');
  });

  it('returns "N min ago" for less than 60 minutes', () => {
    const genAt = new Date(NOW_MS - 25 * 60_000).toISOString();
    expect(formatAge(genAt, NOW_MS)).toBe('25 min ago');
  });

  it('returns "1 hr ago" for exactly 1 hour', () => {
    const genAt = new Date(NOW_MS - 60 * 60_000).toISOString();
    expect(formatAge(genAt, NOW_MS)).toBe('1 hr ago');
  });

  it('returns "N hr ago" for several hours', () => {
    const genAt = new Date(NOW_MS - 3 * 60 * 60_000).toISOString();
    expect(formatAge(genAt, NOW_MS)).toBe('3 hr ago');
  });

  it('returns "over a day ago" for 24+ hours', () => {
    const genAt = new Date(NOW_MS - 25 * 60 * 60_000).toISOString();
    expect(formatAge(genAt, NOW_MS)).toBe('over a day ago');
  });
});

// ─── FreshnessBar component ────────────────────────────────────────────────────

describe('FreshnessBar', () => {
  it('renders "Live" label when fresh', () => {
    const { getByText } = render(
      <FreshnessBar
        generatedAt={GENERATED_AT}
        expiresAt={EXPIRES_AT}
        nowMs={EXPIRES_MS - 2 * 60 * 60 * 1000}
      />,
    );
    expect(getByText('Live')).toBeTruthy();
  });

  it('renders "Stale" label when expired', () => {
    const { getByText } = render(
      <FreshnessBar
        generatedAt={GENERATED_AT}
        expiresAt={EXPIRES_AT}
        nowMs={EXPIRES_MS + 60_000}
      />,
    );
    expect(getByText('Stale')).toBeTruthy();
  });

  it('renders "Offline" label when offline and stale', () => {
    const { getByText } = render(
      <FreshnessBar
        generatedAt={GENERATED_AT}
        expiresAt={EXPIRES_AT}
        nowMs={EXPIRES_MS + 60_000}
        isOffline={true}
      />,
    );
    expect(getByText('Offline')).toBeTruthy();
  });

  it('renders "Aging" label when within 30 min of expiry', () => {
    const { getByText } = render(
      <FreshnessBar
        generatedAt={GENERATED_AT}
        expiresAt={EXPIRES_AT}
        nowMs={EXPIRES_MS - 10 * 60 * 1000}
      />,
    );
    expect(getByText('Aging')).toBeTruthy();
  });

  it('includes "Pull to refresh" text when stale', () => {
    const { getByText } = render(
      <FreshnessBar
        generatedAt={GENERATED_AT}
        expiresAt={EXPIRES_AT}
        nowMs={EXPIRES_MS + 60_000}
      />,
    );
    expect(getByText(/Pull to refresh/)).toBeTruthy();
  });

  it('includes "Offline" in message when offline and stale', () => {
    const { getAllByText } = render(
      <FreshnessBar
        generatedAt={GENERATED_AT}
        expiresAt={EXPIRES_AT}
        nowMs={EXPIRES_MS + 60_000}
        isOffline={true}
      />,
    );
    // Both the label ("Offline") and the message body contain "Offline"
    expect(getAllByText(/Offline/).length).toBeGreaterThanOrEqual(1);
  });
});
