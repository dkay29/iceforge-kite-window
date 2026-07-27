/**
 * FreshnessBar — communicates forecast age and staleness to the user.
 *
 * States:
 *   fresh   — generatedAt is recent and now < expiresAt  (green / subtle)
 *   aging   — expiresAt is within 30 min of now          (amber)
 *   stale   — now >= expiresAt                           (red, prominent)
 *   offline — no network + stale data                    (red, offline icon)
 *
 * The component never hides cached data; instead it labels its age so the
 * user always knows whether they are looking at live or cached conditions.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FreshnessState = 'fresh' | 'aging' | 'stale' | 'offline';

export interface FreshnessBarProps {
  generatedAt: string; // ISO 8601 UTC
  expiresAt: string; // ISO 8601 UTC
  isOffline?: boolean;
  /** Override current time for testing. */
  nowMs?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AGING_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes before expiry

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeFreshnessState(
  generatedAt: string,
  expiresAt: string,
  nowMs: number,
  isOffline = false,
): FreshnessState {
  const expiresMs = new Date(expiresAt).getTime();
  if (isOffline && nowMs >= expiresMs) return 'offline';
  if (nowMs >= expiresMs) return 'stale';
  if (expiresMs - nowMs <= AGING_THRESHOLD_MS) return 'aging';
  return 'fresh';
}

export function formatAge(generatedAt: string, nowMs: number): string {
  const ageMs = nowMs - new Date(generatedAt).getTime();
  if (ageMs < 0) return 'just now';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hr ago';
  if (hours < 24) return `${hours} hr ago`;
  return 'over a day ago';
}

// ─── Styles per state ─────────────────────────────────────────────────────────

const STATE_STYLES: Record<
  FreshnessState,
  { bg: string; text: string; icon: string; label: string }
> = {
  fresh: { bg: '#F0FFF4', text: '#276749', icon: '●', label: 'Live' },
  aging: { bg: '#FFFBEB', text: '#92400E', icon: '◑', label: 'Aging' },
  stale: { bg: '#FFF1F0', text: '#991B1B', icon: '⚠', label: 'Stale' },
  offline: { bg: '#FFF1F0', text: '#991B1B', icon: '✈', label: 'Offline' },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function FreshnessBar({
  generatedAt,
  expiresAt,
  isOffline = false,
  nowMs: nowMsOverride,
}: FreshnessBarProps): React.JSX.Element {
  const [nowMs, setNowMs] = useState(() => nowMsOverride ?? Date.now());

  // Update clock every minute when no override is provided
  useEffect(() => {
    if (nowMsOverride !== undefined) {
      setNowMs(nowMsOverride);
      return;
    }
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [nowMsOverride]);

  const state = computeFreshnessState(generatedAt, expiresAt, nowMs, isOffline);
  const age = formatAge(generatedAt, nowMs);
  const { bg, text, icon, label } = STATE_STYLES[state];

  const message = (() => {
    if (state === 'offline') return `Offline — showing cached data from ${age}`;
    if (state === 'stale') return `Forecast expired — data from ${age}. Pull to refresh.`;
    if (state === 'aging') return `Forecast from ${age} — refreshing soon`;
    return `Updated ${age}`;
  })();

  return (
    <View style={[styles.bar, { backgroundColor: bg }]}>
      <Text style={[styles.icon, { color: text }]}>{icon}</Text>
      <Text style={[styles.label, { color: text }]}>{label}</Text>
      <Text style={[styles.message, { color: text }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  icon: { fontSize: 12 },
  label: { fontSize: 12, fontWeight: '700' },
  message: { fontSize: 12, flex: 1 },
});
