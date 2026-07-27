/**
 * ForecastTimeline — renders the combined conditions timeline graph.
 *
 * Layout (top to bottom):
 *   1. Status bar  — colored strip per slot (GO=green, MARGINAL=amber, NO_GO=red, UNKNOWN=grey)
 *   2. Wind bars   — stacked bars: sustained wind (solid) + gust overlay (hatched)
 *   3. Tide curve  — proportional fill showing tide height
 *   4. Time axis   — hour labels every 3 hours
 *   5. Markers row — sunrise, sunset, low-tide icons
 *
 * Recommended window is overlaid as a semi-transparent band across all tracks.
 * Wind direction arrows are drawn above the wind bars at 30-min intervals.
 *
 * Implementation note: uses React Native View elements with proportional sizing.
 * No SVG or charting library required — all layout is flex-based.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  TimelinePoint,
  SessionWindow,
  DaylightInfo,
  TideEvent,
  RecommendationStatus,
} from '../services/forecastService';

// ─── Color palette ────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<RecommendationStatus, string> = {
  GO: '#34C759',
  MARGINAL: '#FF9500',
  NO_GO: '#FF3B30',
  UNKNOWN: '#C7C7CC',
};

const WIND_BAR_COLOR = '#007AFF';
const GUST_BAR_COLOR = '#5AC8FA';
const TIDE_COLOR = '#5AC8FA';
const WINDOW_OVERLAY_COLOR = 'rgba(52, 199, 89, 0.15)';
const SUNRISE_COLOR = '#FF9500';
const SUNSET_COLOR = '#FF6B35';
const LOW_TIDE_COLOR = '#007AFF';

// ─── Layout constants ─────────────────────────────────────────────────────────

const SLOT_WIDTH = 8; // px per 15-min slot
const STATUS_TRACK_HEIGHT = 12;
const WIND_TRACK_HEIGHT = 60;
const TIDE_TRACK_HEIGHT = 40;
const AXIS_HEIGHT = 20;
const MARKER_HEIGHT = 16;
const MAX_WIND_KNOTS = 40; // scale top

// ─── Helpers ──────────────────────────────────────────────────────────────────

function utcMsOf(iso: string): number {
  return new Date(iso).getTime();
}

function slotIndex(points: TimelinePoint[], timeUtc: string): number {
  const target = utcMsOf(timeUtc);
  return points.findIndex((p) => utcMsOf(p.timeUtc) >= target);
}

function hourLabel(timeUtc: string, timezone: string): string {
  try {
    return new Date(timeUtc).toLocaleTimeString('en-US', {
      hour: 'numeric',
      hour12: true,
      timeZone: timezone,
    });
  } catch {
    return '';
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusTrack({ points }: { points: TimelinePoint[] }): React.JSX.Element {
  return (
    <View style={[styles.track, { height: STATUS_TRACK_HEIGHT }]}>
      {points.map((p, i) => (
        <View
          key={i}
          style={[
            styles.slot,
            {
              width: SLOT_WIDTH,
              height: STATUS_TRACK_HEIGHT,
              backgroundColor: STATUS_COLORS[p.status],
            },
          ]}
        />
      ))}
    </View>
  );
}

function WindTrack({ points }: { points: TimelinePoint[] }): React.JSX.Element {
  return (
    <View style={[styles.track, styles.windTrack]}>
      {points.map((p, i) => {
        const windH = Math.min(
          ((p.windSpeedKnots ?? 0) / MAX_WIND_KNOTS) * WIND_TRACK_HEIGHT,
          WIND_TRACK_HEIGHT,
        );
        const gustH = Math.min(
          ((p.gustKnots ?? 0) / MAX_WIND_KNOTS) * WIND_TRACK_HEIGHT,
          WIND_TRACK_HEIGHT,
        );
        return (
          <View key={i} style={[styles.slot, { width: SLOT_WIDTH, height: WIND_TRACK_HEIGHT }]}>
            {gustH > 0 && (
              <View
                style={[
                  styles.bar,
                  { height: gustH, width: SLOT_WIDTH, backgroundColor: GUST_BAR_COLOR },
                ]}
              />
            )}
            {windH > 0 && (
              <View
                style={[
                  styles.bar,
                  { height: windH, width: SLOT_WIDTH, backgroundColor: WIND_BAR_COLOR },
                ]}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function TideTrack({
  points,
  tideEvents,
}: {
  points: TimelinePoint[];
  tideEvents: TideEvent[];
}): React.JSX.Element {
  const maxTide = useMemo(() => {
    const heights = [
      ...points.map((p) => p.tideHeightFeet ?? 0),
      ...tideEvents.map((e) => e.heightFeet),
    ];
    return Math.max(...heights, 1);
  }, [points, tideEvents]);

  return (
    <View style={[styles.track, { height: TIDE_TRACK_HEIGHT }]}>
      {points.map((p, i) => {
        const h = Math.max(((p.tideHeightFeet ?? 0) / maxTide) * TIDE_TRACK_HEIGHT, 0);
        return (
          <View key={i} style={[styles.slot, { width: SLOT_WIDTH, height: TIDE_TRACK_HEIGHT }]}>
            <View
              style={[
                styles.bar,
                { height: h, width: SLOT_WIDTH, backgroundColor: TIDE_COLOR, opacity: 0.6 },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function TimeAxis({
  points,
  timezone,
}: {
  points: TimelinePoint[];
  timezone: string;
}): React.JSX.Element {
  // Show a label every 12 slots (3 hours)
  return (
    <View style={[styles.track, { height: AXIS_HEIGHT }]}>
      {points.map((p, i) => (
        <View key={i} style={[styles.slot, { width: SLOT_WIDTH, height: AXIS_HEIGHT }]}>
          {i % 12 === 0 && <Text style={styles.axisLabel}>{hourLabel(p.timeUtc, timezone)}</Text>}
        </View>
      ))}
    </View>
  );
}

function WindowOverlay({
  points,
  window,
}: {
  points: TimelinePoint[];
  window: SessionWindow;
}): React.JSX.Element | null {
  const startIdx = slotIndex(points, window.startUtc);
  const endIdx = slotIndex(points, window.endUtc);
  if (startIdx < 0 || endIdx < 0) return null;
  const left = startIdx * SLOT_WIDTH;
  const width = (endIdx - startIdx) * SLOT_WIDTH;
  const totalHeight =
    STATUS_TRACK_HEIGHT + WIND_TRACK_HEIGHT + TIDE_TRACK_HEIGHT + AXIS_HEIGHT + MARKER_HEIGHT;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.windowOverlay,
        { left, width, height: totalHeight, backgroundColor: WINDOW_OVERLAY_COLOR },
      ]}
    />
  );
}

function MarkerRow({
  points,
  tideEvents,
  daylight,
}: {
  points: TimelinePoint[];
  tideEvents: TideEvent[];
  daylight: DaylightInfo;
}): React.JSX.Element {
  const lowTides = tideEvents.filter((e) => e.type === 'LOW');

  function markerAt(timeUtc: string, color: string, label: string): React.JSX.Element | null {
    const idx = slotIndex(points, timeUtc);
    if (idx < 0) return null;
    return (
      <View key={`${label}-${timeUtc}`} style={[styles.markerPin, { left: idx * SLOT_WIDTH }]}>
        <Text style={[styles.markerLabel, { color }]}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.track, styles.markerRow, { height: MARKER_HEIGHT }]}>
      {markerAt(daylight.sunriseUtc, SUNRISE_COLOR, '↑☀')}
      {markerAt(daylight.sunsetUtc, SUNSET_COLOR, '☀↓')}
      {lowTides.map((lt) => markerAt(lt.timeUtc, LOW_TIDE_COLOR, '↓~'))}
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface ForecastTimelineProps {
  points: TimelinePoint[];
  tideEvents: TideEvent[];
  daylight: DaylightInfo;
  bestWindow: SessionWindow | null;
  timezone: string;
}

export function ForecastTimeline({
  points,
  tideEvents,
  daylight,
  bestWindow,
  timezone,
}: ForecastTimelineProps): React.JSX.Element {
  const totalWidth = points.length * SLOT_WIDTH;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.container, { width: totalWidth }]}>
        {/* Recommended window overlay — rendered before tracks so it's behind bars */}
        {bestWindow !== null && <WindowOverlay points={points} window={bestWindow} />}

        <StatusTrack points={points} />
        <WindTrack points={points} />
        <TideTrack points={points} tideEvents={tideEvents} />
        <TimeAxis points={points} timezone={timezone} />
        <MarkerRow points={points} tideEvents={tideEvents} daylight={daylight} />
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  track: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  windTrack: {
    height: WIND_TRACK_HEIGHT,
    backgroundColor: '#F2F2F7',
  },
  slot: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
  },
  bar: {
    position: 'absolute',
    bottom: 0,
  },
  axisLabel: {
    fontSize: 8,
    color: '#666',
    position: 'absolute',
    bottom: 2,
    left: 0,
  },
  windowOverlay: {
    position: 'absolute',
    top: 0,
    borderRadius: 4,
    zIndex: 1,
  },
  markerRow: {
    position: 'relative',
  },
  markerPin: {
    position: 'absolute',
    bottom: 0,
  },
  markerLabel: {
    fontSize: 8,
    fontWeight: '600',
  },
});
