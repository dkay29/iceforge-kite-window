/**
 * 15-minute timeline normalizer.
 *
 * Merges NWS weather intervals, NOAA hi-lo tide events, and solar events
 * into a canonical Normalized15MinuteTimeline document.
 *
 * Timeline rules:
 * - Slots are at 15-minute UTC boundaries covering the spot's local calendar day.
 * - Each slot represents the half-open interval [slotTime, slotTime + 15 min).
 * - NWS fields come from the interval that contains the slot time (constant value
 *   throughout the NWS interval — no interpolation between intervals).
 * - Tide height is linearly interpolated between neighbouring hi-lo events.
 * - isDaylight is calculated from civil twilight bounds.
 * - dataSource is FORECAST for NWS, INTERPOLATED for tide, CALCULATED for solar.
 * - MISSING is used when no value is available.
 */

import {
  MAX_INTERPOLATION_GAP_MS,
  STALENESS_THRESHOLD_MS,
  interpolateScalar,
  isStale,
  linearInterpolate,
} from './interpolation.js';
import type { SolarEvents } from './solar.js';
import { isDaytime } from './solar.js';
import type { NwsWeatherData, NwsTimeInterval } from '../providers/nws/nwsWeatherAdapter.js';
import type { TideFetchResult } from '../providers/noaa/noaaTideAdapter.js';
import type {
  Normalized15MinuteTimeline,
  TimelineSlot,
  SourceRecord,
} from '../generated/schema-types.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface NormalizationInput {
  spotId: string;
  localDate: string;
  /** UTC ms start of the local calendar day (midnight in spot's timezone). */
  dayStartUtcMs: number;
  nwsData: NwsWeatherData;
  tideResult: TideFetchResult;
  solarEvents: SolarEvents;
  generatedAtMs: number;
  /** UTC ms of the current instant (used for staleness checks). */
  nowMs: number;
}

// ─── Main function ────────────────────────────────────────────────────────────

export function normalizeTimeline(input: NormalizationInput): Normalized15MinuteTimeline {
  const { spotId, localDate, dayStartUtcMs, nwsData, tideResult, solarEvents, generatedAtMs } =
    input;

  const slotTimes = generateSlotTimes(dayStartUtcMs);

  // Prepare tide point data for interpolation
  const tidePoints = tideResult.events.map((e) => ({ timeMs: e.timeUtcMs, value: e.heightFeet }));
  const tideHeights = interpolateScalar(
    tidePoints,
    slotTimes,
    MAX_INTERPOLATION_GAP_MS['tideHeightFeet']!,
    linearInterpolate,
  );

  const nwsIsStale = isStale(
    new Date(nwsData.source.retrievedAt).getTime(),
    input.nowMs,
    STALENESS_THRESHOLD_MS['nwsForecast']!,
  );
  const tideIsStale = isStale(
    new Date(tideResult.source.retrievedAt).getTime(),
    input.nowMs,
    STALENESS_THRESHOLD_MS['noaaTidePredictions']!,
  );

  const slots: TimelineSlot[] = slotTimes.map((slotMs, i) => {
    const timeUtc = new Date(slotMs).toISOString();
    const interpolatedFields: string[] = [];

    const windSpeedKnots = lookupInterval(nwsData.windSpeedKnotsIntervals, slotMs);
    const windDirectionDegrees = lookupInterval(nwsData.windDirectionIntervals, slotMs);
    const gustSpeedKnots = lookupInterval(nwsData.windGustKnotsIntervals, slotMs);
    const temperatureCelsius = lookupInterval(nwsData.temperatureCelsiusIntervals, slotMs);
    const probabilityOfPrecipitation = lookupInterval(nwsData.precipProbabilityIntervals, slotMs);
    const probabilityOfThunder = lookupInterval(nwsData.thunderProbabilityIntervals, slotMs);
    const skyCoverPercent = lookupInterval(nwsData.skyCoverPercentIntervals, slotMs);

    const rawTideHeight = tideHeights[i]!;
    const tideHeightFeet = rawTideHeight;
    // Tide is always interpolated (from hi-lo events)
    if (tideHeightFeet !== null) {
      interpolatedFields.push('tideHeightFeet');
    }

    const isDaylightValue = isDaytime(slotMs, solarEvents);

    // Determine data source and confidence
    const hasNwsData =
      windSpeedKnots !== null || windDirectionDegrees !== null || gustSpeedKnots !== null;
    const hasTideData = tideHeightFeet !== null;

    let dataSource: TimelineSlot['dataSource'];
    if (!hasNwsData && !hasTideData) {
      dataSource = 'MISSING';
    } else if (interpolatedFields.length > 0 && !hasNwsData) {
      dataSource = 'INTERPOLATED';
    } else {
      dataSource = 'FORECAST';
    }

    const confidence = computeConfidence(
      windSpeedKnots,
      windDirectionDegrees,
      gustSpeedKnots,
      tideHeightFeet,
      nwsIsStale,
      tideIsStale,
    );

    const slot: TimelineSlot = {
      timeUtc,
      windSpeedKnots,
      windDirectionDegrees,
      gustSpeedKnots,
      tideHeightFeet,
      temperatureCelsius,
      probabilityOfPrecipitation,
      probabilityOfThunder,
      skyCoverPercent,
      isDaylight: isDaylightValue,
      dataSource,
      interpolatedFields,
      confidence,
    };

    return slot;
  });

  const sources = buildSources(nwsData, tideResult, solarEvents, generatedAtMs);

  return {
    schemaVersion: '1.0',
    spotId,
    localDate,
    generatedAt: new Date(generatedAtMs).toISOString(),
    slots: slots as [TimelineSlot, ...TimelineSlot[]],
    sources,
  };
}

// ─── Utility: local-day slot generation ──────────────────────────────────────

/** Round a UTC ms value up to the next 15-minute boundary. */
export function ceilTo15MinMs(utcMs: number): number {
  const SLOT_MS = 15 * 60 * 1000;
  const remainder = utcMs % SLOT_MS;
  return remainder === 0 ? utcMs : utcMs + SLOT_MS - remainder;
}

/**
 * Generate 96 15-minute slot times starting at the first 15-min UTC boundary
 * on or after `dayStartUtcMs`, covering one full local day (24 hours).
 */
export function generateSlotTimes(dayStartUtcMs: number): number[] {
  const SLOT_MS = 15 * 60 * 1000;
  const start = ceilTo15MinMs(dayStartUtcMs);
  return Array.from({ length: 96 }, (_, i) => start + i * SLOT_MS);
}

/**
 * Find the UTC ms corresponding to midnight of a local date in the given
 * IANA timezone. Uses an iterative probe approach over ±14 hours.
 *
 * @throws {Error} when no matching midnight is found (invalid date or timezone).
 */
export function localMidnightToUtcMs(localDate: string, timezone: string): number {
  const [yearStr, monthStr, dayStr] = localDate.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!year || !month || !day) {
    throw new Error(`Invalid localDate: "${localDate}"`);
  }

  // Probe around UTC midnight of the given date ±14 hours in 1-minute steps
  const nominalMs = Date.UTC(year, month - 1, day, 0, 0, 0);

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // Scan for the UTC moment that equals midnight local time (00:00)
  for (let offsetMin = -14 * 60; offsetMin <= 14 * 60; offsetMin++) {
    const candidate = nominalMs + offsetMin * 60000;
    const parts = fmt.formatToParts(new Date(candidate));
    const partsMap: Record<string, string> = {};
    for (const p of parts) partsMap[p.type] = p.value;

    const localYear = partsMap['year'];
    const localMonth = partsMap['month'];
    const localDay = partsMap['day'];
    const localHour = partsMap['hour'];
    const localMinute = partsMap['minute'];

    if (
      localYear === String(year) &&
      localMonth === String(month).padStart(2, '0') &&
      localDay === String(day).padStart(2, '0') &&
      (localHour === '00' || localHour === '0') &&
      localMinute === '00'
    ) {
      return candidate;
    }
  }

  throw new Error(`Cannot determine local midnight for ${localDate} in ${timezone}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lookupInterval(intervals: NwsTimeInterval[], slotMs: number): number | null {
  for (const interval of intervals) {
    if (interval.startUtcMs <= slotMs && slotMs < interval.endUtcMs) {
      return interval.value;
    }
  }
  return null;
}

function computeConfidence(
  windSpeedKnots: number | null,
  windDirectionDegrees: number | null,
  gustSpeedKnots: number | null,
  tideHeightFeet: number | null,
  nwsIsStale: boolean,
  tideIsStale: boolean,
): number | null {
  const windPresent = windSpeedKnots !== null && windDirectionDegrees !== null;
  if (!windPresent && gustSpeedKnots === null && tideHeightFeet === null) {
    return null; // no meaningful data
  }

  let confidence = 1.0;
  if (windSpeedKnots === null) confidence -= 0.15;
  if (windDirectionDegrees === null) confidence -= 0.15;
  if (gustSpeedKnots === null) confidence -= 0.05;
  if (tideHeightFeet === null) confidence -= 0.05;
  if (nwsIsStale) confidence -= 0.1;
  if (tideIsStale) confidence -= 0.05;

  return Math.max(0, Math.round(confidence * 100) / 100);
}

function buildSources(
  nwsData: NwsWeatherData,
  tideResult: TideFetchResult,
  solarEvents: SolarEvents,
  generatedAtMs: number,
): Normalized15MinuteTimeline['sources'] {
  const nws: SourceRecord = {
    provider: nwsData.source.provider,
    retrievedAt: nwsData.source.retrievedAt,
    ...(nwsData.source.validFrom !== null && { validFrom: nwsData.source.validFrom }),
    ...(nwsData.source.validTo !== null && { validTo: nwsData.source.validTo }),
    isStale: false, // caller decides staleness; we report based on field
    attribution: nwsData.source.attribution,
  };

  const noaaTide: SourceRecord = {
    provider: tideResult.source.provider,
    retrievedAt: tideResult.source.retrievedAt,
    ...(tideResult.source.validFrom !== null && { validFrom: tideResult.source.validFrom }),
    ...(tideResult.source.validTo !== null && { validTo: tideResult.source.validTo }),
    isStale: false,
    attribution: tideResult.source.attribution,
  };

  const solar: SourceRecord = {
    provider: 'solar-calc',
    retrievedAt: new Date(generatedAtMs).toISOString(),
    attribution: 'Calculated from spot coordinates and IANA timezone',
  };

  void solarEvents; // used indirectly via isDaytime

  return { nws, noaaTide, solar };
}
