/**
 * Published forecast document assembly.
 *
 * Combines the window-selection result, solar events, tide events, and
 * source attribution into a presentation-ready PublishedSpotForecast that
 * the mobile client renders directly without reconstructing decision rules.
 *
 * Freshness contract:
 *   - `generatedAt` — UTC timestamp of this run.
 *   - `expiresAt`   — generatedAt + freshnessMs (default 4 hours), signalling
 *     when the client should re-fetch.
 *   - `revision`    — the forecastRunId (ISO 8601 UTC), monotonically increasing.
 *
 * The document is immutable after publication; updates are published as new
 * objects under new S3 keys.
 */

import type { SolarEvents } from './solar.js';
import type { WindowSelectorResult } from './windowSelector.js';
import type { TideFetchResult } from '../providers/noaa/noaaTideAdapter.js';
import type {
  PublishedSpotForecast,
  TimelinePoint,
  Normalized15MinuteTimeline,
} from '../generated/schema-types.js';

/** Default freshness window: 4 hours. */
const DEFAULT_FRESHNESS_MS = 4 * 60 * 60 * 1000;

// ─── Public types ──────────────────────────────────────────────────────────────

export interface SpotSummary {
  spotId: string;
  name: string;
  region?: string;
  timezone: string;
}

export interface ForecastBuildInput {
  spot: SpotSummary;
  /** Calendar date in the spot's timezone (YYYY-MM-DD). */
  localDate: string;
  /** All tide events for the local date (HIGH and LOW, from NOAA adapter). */
  tideResult: TideFetchResult;
  /** Calculated solar events for the local date at the spot's coordinates. */
  solarEvents: SolarEvents;
  /** Normalized 15-minute timeline (used for source attribution). */
  timeline: Normalized15MinuteTimeline;
  /** Output of the window selector for this date. */
  windowResult: WindowSelectorResult;
  /** UTC ms when this document was assembled. */
  generatedAtMs: number;
  /**
   * Monotonically increasing run identifier (ISO 8601 UTC).
   * Used as the S3 object key disambiguator and the `revision` field.
   */
  forecastRunId: string;
  /**
   * How long (in ms) before the document should be refreshed.
   * Defaults to 4 hours.
   */
  freshnessMs?: number;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Assemble a presentation-ready PublishedSpotForecast from pipeline outputs.
 *
 * @throws {Error} if required solar events (sunrise, sunset, civil twilight)
 *   are null — polar night / midnight sun is not supported in the current MVP.
 */
export function buildForecast(input: ForecastBuildInput): PublishedSpotForecast {
  const { spot, localDate, tideResult, solarEvents, timeline, windowResult } = input;
  const { generatedAtMs, forecastRunId, freshnessMs = DEFAULT_FRESHNESS_MS } = input;

  const generatedAt = new Date(generatedAtMs).toISOString();
  const expiresAt = new Date(generatedAtMs + freshnessMs).toISOString();

  const daylight = buildDaylight(solarEvents);

  const tideEvents = tideResult.events.map((e) => ({
    timeUtc: new Date(e.timeUtcMs).toISOString(),
    type: e.type,
    heightFeet: e.heightFeet,
    station: tideResult.source.stationName,
    datum: tideResult.source.datum,
  }));

  const assessment = buildAssessment(windowResult);

  const sourceAttribution = buildSourceAttribution(timeline, tideResult);

  const forecast: PublishedSpotForecast = {
    schemaVersion: '1.0',
    spot: {
      spotId: spot.spotId,
      name: spot.name,
      timezone: spot.timezone,
      ...(spot.region !== undefined && { region: spot.region }),
    },
    localDate,
    generatedAt,
    expiresAt,
    daylight,
    tideEvents,
    assessment,
    ...(sourceAttribution.length > 0 && { sourceAttribution }),
    revision: forecastRunId,
  };

  return forecast;
}

// ─── Daylight builder ─────────────────────────────────────────────────────────

function buildDaylight(solar: SolarEvents): PublishedSpotForecast['daylight'] {
  if (
    solar.sunriseUtcMs === null ||
    solar.sunsetUtcMs === null ||
    solar.civilTwilightBeginUtcMs === null ||
    solar.civilTwilightEndUtcMs === null
  ) {
    throw new Error(
      'Cannot build forecast: required solar events are null (polar night or midnight sun not supported)',
    );
  }

  return {
    sunriseUtc: new Date(solar.sunriseUtcMs).toISOString(),
    sunsetUtc: new Date(solar.sunsetUtcMs).toISOString(),
    civilTwilightBeginUtc: new Date(solar.civilTwilightBeginUtcMs).toISOString(),
    civilTwilightEndUtc: new Date(solar.civilTwilightEndUtcMs).toISOString(),
  };
}

// ─── Assessment builder ───────────────────────────────────────────────────────

function buildAssessment(windowResult: WindowSelectorResult): PublishedSpotForecast['assessment'] {
  const { status, bestWindow, alternatives, blockingConstraints, warnings, timelinePoints } =
    windowResult;

  // timelinePoints must be non-empty (schema requires minItems: 1)
  if (timelinePoints.length === 0) {
    throw new Error('Cannot build forecast: timelinePoints is empty');
  }

  const assessment: PublishedSpotForecast['assessment'] = {
    status,
    bestWindow,
    alternatives,
    timelinePoints: timelinePoints as [TimelinePoint, ...TimelinePoint[]],
    ...(blockingConstraints.length > 0 && { blockingConstraints }),
    ...(warnings.length > 0 && { warnings }),
  };

  return assessment;
}

// ─── Source attribution builder ───────────────────────────────────────────────

type AttributionRecord = {
  provider: string;
  retrievedAt: string;
  url?: string;
  attribution?: string;
};

function buildSourceAttribution(
  timeline: Normalized15MinuteTimeline,
  tideResult: TideFetchResult,
): AttributionRecord[] {
  return [
    {
      provider: timeline.sources.nws.provider,
      retrievedAt: timeline.sources.nws.retrievedAt,
      ...(timeline.sources.nws.attribution !== undefined && {
        attribution: timeline.sources.nws.attribution,
      }),
    },
    {
      provider: tideResult.source.provider,
      retrievedAt: tideResult.source.retrievedAt,
      ...(tideResult.source.attribution !== undefined && {
        attribution: tideResult.source.attribution,
      }),
    },
    {
      provider: timeline.sources.solar.provider,
      retrievedAt: timeline.sources.solar.retrievedAt,
      ...(timeline.sources.solar.attribution !== undefined && {
        attribution: timeline.sources.solar.attribution,
      }),
    },
  ];
}
