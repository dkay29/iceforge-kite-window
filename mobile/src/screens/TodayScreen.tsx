/**
 * Today screen — shows the daily forecast and recommended kite window.
 *
 * Fetches the published forecast from the API and renders:
 *   - Recommendation badge (GO / MARGINAL / NO_GO)
 *   - Recommended window time and score
 *   - Combined conditions timeline graph
 *   - Blocking constraints and warnings
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ForecastTimeline } from '../components/ForecastTimeline';
import {
  ForecastService,
  ForecastNotAvailableError,
  type SpotForecast,
  type ForecastHttpClient,
} from '../services/forecastService';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Today'>;

// ─── Constants ────────────────────────────────────────────────────────────────

const SPOT_ID = 'west-dennis-beach-ma';

const STATUS_COLORS = {
  GO: '#34C759',
  MARGINAL: '#FF9500',
  NO_GO: '#FF3B30',
  UNKNOWN: '#8E8E93',
};

// ─── Placeholder HTTP client (replaced with Amplify REST in issue #29) ────────

function makePlaceholderHttpClient(): ForecastHttpClient {
  return {
    get: async () => ({ status: 404, body: {}, headers: {} }),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayLocalDate(timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    return parts
      .filter((p) => p.type !== 'literal')
      .map((p) => p.value)
      .join('-');
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatWindowTime(utc: string, timezone: string): string {
  try {
    return new Date(utc).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    });
  } catch {
    return utc;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TodayScreen(_navProps: Props): React.JSX.Element {
  const [forecast, setForecast] = useState<SpotForecast | null>(null);
  const [etag, setEtag] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const timezone = forecast?.spot.timezone ?? 'America/New_York';
        const date = todayLocalDate(timezone);
        const service = new ForecastService(makePlaceholderHttpClient());
        const result = await service.get(SPOT_ID, date, isRefresh ? etag : undefined);
        if (result !== null) {
          setForecast(result.forecast);
          setEtag(result.etag);
        }
      } catch (err) {
        if (!(err instanceof ForecastNotAvailableError)) {
          setError('Could not load forecast. Check your connection and try again.');
        } else {
          setError('No forecast is available for today yet.');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [forecast, etag],
  );

  // Load once on mount. Refresh triggered by the pull-to-refresh RefreshControl.
  useEffect(() => {
    void load(false);
  }, []); // empty deps: intentionally runs once on mount

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (error !== null || forecast === null) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'No forecast available.'}</Text>
      </SafeAreaView>
    );
  }

  const { assessment, timeline, tideEvents, daylight, spot, localDate } = forecast;
  const statusColor = STATUS_COLORS[assessment.status] ?? STATUS_COLORS.UNKNOWN;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />
        }
      >
        {/* Header — date and spot */}
        <View style={styles.header}>
          <Text style={styles.spotName}>{spot.name}</Text>
          <Text style={styles.date}>{localDate}</Text>
        </View>

        {/* Recommendation badge */}
        <View style={[styles.badge, { backgroundColor: statusColor }]}>
          <Text style={styles.badgeText}>{assessment.status}</Text>
          {assessment.bestWindow !== null && (
            <Text style={styles.windowTime}>
              {formatWindowTime(assessment.bestWindow.startUtc, spot.timezone)} –{' '}
              {formatWindowTime(assessment.bestWindow.endUtc, spot.timezone)}
              {'  '}
              Score: {Math.round(assessment.bestWindow.score)}
            </Text>
          )}
        </View>

        {/* Blocking constraints */}
        {(assessment.blockingConstraints ?? []).length > 0 && (
          <View style={styles.section}>
            {(assessment.blockingConstraints ?? []).map((c, i) => (
              <Text key={i} style={styles.constraint}>
                ✗ {c}
              </Text>
            ))}
          </View>
        )}

        {/* Warnings */}
        {(assessment.warnings ?? []).length > 0 && (
          <View style={styles.section}>
            {(assessment.warnings ?? []).map((w, i) => (
              <Text key={i} style={styles.warning}>
                ⚠ {w}
              </Text>
            ))}
          </View>
        )}

        {/* Timeline */}
        <View style={styles.timelineSection}>
          <Text style={styles.sectionTitle}>Conditions Timeline</Text>
          <ForecastTimeline
            points={timeline.timelinePoints}
            tideEvents={tideEvents}
            daylight={daylight}
            bestWindow={assessment.bestWindow}
            timezone={spot.timezone}
          />
          <View style={styles.legend}>
            <LegendItem color="#34C759" label="GO" />
            <LegendItem color="#FF9500" label="Marginal" />
            <LegendItem color="#FF3B30" label="No Go" />
            <LegendItem color="#007AFF" label="Wind" />
            <LegendItem color="#5AC8FA" label="Gust / Tide" />
          </View>
        </View>

        {/* Reasons */}
        {(assessment.reasons ?? []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Why</Text>
            {(assessment.reasons ?? []).map((r, i) => (
              <Text key={i} style={styles.reason}>
                • {r}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function LegendItem({ color, label }: { color: string; label: string }): React.JSX.Element {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: '#666', textAlign: 'center', fontSize: 16 },
  header: { paddingHorizontal: 16, paddingTop: 16 },
  spotName: { fontSize: 20, fontWeight: '700' },
  date: { fontSize: 14, color: '#666', marginTop: 2 },
  badge: {
    margin: 16,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  badgeText: { fontSize: 28, fontWeight: '800', color: '#fff' },
  windowTime: { fontSize: 14, color: 'rgba(255,255,255,0.9)', marginTop: 4 },
  section: { paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  constraint: { fontSize: 14, color: '#FF3B30', marginBottom: 4 },
  warning: { fontSize: 14, color: '#FF9500', marginBottom: 4 },
  reason: { fontSize: 14, color: '#333', marginBottom: 4 },
  timelineSection: { paddingHorizontal: 16, marginBottom: 16 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendSwatch: { width: 12, height: 12, borderRadius: 2, marginRight: 4 },
  legendLabel: { fontSize: 11, color: '#666' },
});
