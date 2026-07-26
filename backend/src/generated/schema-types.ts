/* eslint-disable */
/**
 * AUTO-GENERATED — do not edit by hand.
 * Run `npm run generate:types` after schema changes.
 * Source: tools/generate-types.mjs
 */

// ─── spot.schema.json ───────────────────────────────────────────
/**
 * AUTO-GENERATED — do not edit by hand.
 * Run `npm run generate:types` after schema changes.
 * Source: tools/generate-types.mjs
 */

/**
 * Versioned spot configuration. Fields owned by provider-mapping and site-survey issues (NOAA tide station, NWS grid mapping, shore bearing, accepted/prohibited wind sectors) are optional here and must be listed in `unresolved` until validated.
 */
export interface Spot {
  schemaVersion: '1.0';
  /**
   * Configuration revision for this spot document, distinct from schemaVersion.
   */
  version: number;
  spotId: string;
  name: string;
  municipality?: string;
  /**
   * Postal village or locality within the municipality, when the spot is known by a sub-municipal name.
   */
  village?: string;
  state?: string;
  region?: string;
  countryCode?: string;
  /**
   * General spot location. latitude/longitude are optional until validated against an authoritative source; timezone is required.
   */
  location: {
    latitude?: number;
    longitude?: number;
    /**
     * Geodetic datum for the coordinate pair, e.g. 'NAD83' or 'WGS84'.
     */
    datum?: string;
    timezone: string;
  };
  /**
   * Representative beach/launch coordinate, distinct from the spot's general location point.
   */
  launchPoint?: {
    latitude?: number;
    longitude?: number;
    /**
     * Geodetic datum for the coordinate pair, e.g. 'NAD83' or 'WGS84'.
     */
    datum?: string;
    description?: string;
  };
  /**
   * Site-survey data defining beach orientation and safe wind sectors. All three fields must be present for a spot to be VALIDATED.
   */
  shore?: {
    /**
     * Compass bearing (degrees true, clockwise from north) pointing from the beach toward open water. Used as the reference direction for wind classification. An onshore wind is one whose meteorological FROM-direction matches this bearing.
     */
    seawardBearingDegrees?: number;
    /**
     * Wind sectors in which the spot is considered safe and kite-able. Must cover all accepted classifications (DIRECT_ONSHORE and SIDE_ONSHORE).
     *
     * @minItems 1
     */
    acceptedWindSectors?: [WindSector, ...WindSector[]];
    /**
     * Wind sectors that are prohibited or not accepted. When a wind sector's startDegrees > endDegrees the sector wraps through 0°/360° (e.g. startDegrees:330, endDegrees:60 covers 330°–360° and 0°–60°).
     */
    prohibitedWindSectors?: WindSector[];
  };
  /**
   * Provider mappings for weather and tide data. Each sub-field is owned by a provider-adapter issue and absent until that issue resolves it.
   */
  sources?: {
    noaaTideStation?: NoaaTideStation;
    /**
     * NWS grid-point metadata resolved from the Points API for this spot's coordinates. Owned by issue #4.
     */
    nwsGridpoint?: {
      /**
       * NWS CWA (County Warning Area) office identifier, e.g. 'BOX'.
       */
      office: string;
      /**
       * NWS grid X coordinate.
       */
      gridX: number;
      /**
       * NWS grid Y coordinate.
       */
      gridY: number;
      /**
       * NWS point type returned by the Points API ('land' or 'marine').
       */
      pointType: 'land' | 'marine';
      /**
       * NWS forecast zone identifier, e.g. 'ANZ232'.
       */
      forecastZone: string;
      /**
       * Full URL for the NWS 12-hourly forecast endpoint.
       */
      forecastEndpoint: string;
      /**
       * Full URL for the NWS hourly forecast endpoint.
       */
      forecastHourlyEndpoint: string;
      /**
       * Full URL for the NWS grid data endpoint (provides wind direction in degrees and gust values).
       */
      forecastGridDataEndpoint: string;
      /**
       * NEXRAD radar station identifier for the grid cell, e.g. 'KBOX'.
       */
      radarStation: string;
      /**
       * Human-readable attribution required when displaying NWS data.
       */
      attribution: string;
    };
  };
  defaultRulesetId?: string;
  validationStatus: 'UNVALIDATED' | 'PARTIALLY_VALIDATED' | 'VALIDATED';
  /**
   * Must be false until all required safety-critical fields (shore bearing, wind sectors, provider mappings) are validated.
   */
  active: boolean;
  sourceNotes?: string[];
  assumptions?: string[];
  unresolved?: {
    field: string;
    reason: string;
    followUpIssue?: string;
  }[];
}
/**
 * A contiguous arc of wind directions sharing the same safety classification. Arcs are expressed in meteorological FROM-degrees (0° = north, 90° = east). When startDegrees > endDegrees, the arc wraps through 0°/360° (e.g. startDegrees:330, endDegrees:60 covers the north-through-northeast arc).
 */
export interface WindSector {
  /**
   * Inclusive start of the arc in degrees true. When startDegrees > endDegrees, the arc wraps through 0°/360°.
   */
  startDegrees: number;
  /**
   * Exclusive end of the arc in degrees true.
   */
  endDegrees: number;
  /**
   * Wind classification relative to the spot's seawardBearingDegrees. DIRECT_ONSHORE: |diff| ≤ 30°. SIDE_ONSHORE: 30° < |diff| ≤ 75°. CROSS_SHORE: 75° < |diff| ≤ 90°. SIDE_OFFSHORE: 90° < |diff| ≤ 135°. OFFSHORE: |diff| > 135°.
   */
  classification: 'DIRECT_ONSHORE' | 'SIDE_ONSHORE' | 'CROSS_SHORE' | 'SIDE_OFFSHORE' | 'OFFSHORE';
  /**
   * True when this sector is safe and kite-able at this spot.
   */
  accepted: boolean;
}
/**
 * NOAA CO-OPS tide station used for tide predictions at this spot.
 */
export interface NoaaTideStation {
  /**
   * NOAA CO-OPS station identifier (e.g. '8447504').
   */
  stationId: string;
  name: string;
  /**
   * 'H' = harmonic (reference) station with its own tidal constituents; 'S' = subordinate station using offset-adjusted predictions from a reference station.
   */
  stationType: 'H' | 'S';
  /**
   * NOAA CO-OPS ID of the harmonic reference station. Required when stationType is 'S'.
   */
  referenceStationId?: string;
  /**
   * Tidal datum for height values returned by the predictions API (e.g. 'MLLW').
   */
  datum: string;
  lat: number;
  lng: number;
  /**
   * Great-circle distance in kilometres from the spot's general location.
   */
  distanceKm: number;
  /**
   * NOAA CO-OPS product identifiers confirmed available for this station (e.g. 'predictions').
   *
   * @minItems 1
   */
  availableProducts: [string, ...string[]];
  /**
   * Confirmed prediction interval values (e.g. 'hilo', '6', 'h').
   */
  predictionIntervals?: string[];
  fallback: NoaaTideStationFallback;
}
/**
 * Policy for handling NOAA CO-OPS station retrieval failures.
 */
export interface NoaaTideStationFallback {
  /**
   * Ordered list of alternative stations to try, in preference order.
   */
  stations: {
    stationId: string;
    name: string;
    reason: string;
  }[];
  /**
   * Action taken when all stations fail. 'NO_GO' — do not publish a forecast; surface an explicit error to the user.
   */
  onAllFailed: 'NO_GO';
}

// ─── ruleset.schema.json ───────────────────────────────────────────
/**
 * AUTO-GENERATED — do not edit by hand.
 * Run `npm run generate:types` after schema changes.
 * Source: tools/generate-types.mjs
 */

export interface SuitabilityRuleset {
  schemaVersion: '1.0';
  rulesetId: string;
  version: number;
  name?: string;
  session: {
    requiredDurationMinutes: number;
    evaluationIntervalMinutes: 5 | 10 | 15 | 30 | 60;
    lowTideRequirement: 'MUST_BE_INSIDE' | 'MUST_BE_CENTERED' | 'OPTIONAL';
    daylightRequired: boolean;
    [k: string]: any | undefined;
  };
  wind: {
    minimumUsableMph: number;
    preferredMinimumMph: number;
    preferredMaximumMph: number;
    absoluteMaximumMph: number;
    maximumGustMph: number;
    maximumGustSpreadMph: number;
    /**
     * @minItems 1
     */
    acceptedClassifications: [
      'DIRECT_ONSHORE' | 'SIDE_ONSHORE' | 'CROSS_SHORE',
      ...('DIRECT_ONSHORE' | 'SIDE_ONSHORE' | 'CROSS_SHORE')[],
    ];
    [k: string]: any | undefined;
  };
  scoring: {
    [k: string]: any | undefined;
  };
  thresholds: {
    goMinimumScore: number;
    marginalMinimumScore: number;
    [k: string]: any | undefined;
  };
  [k: string]: any | undefined;
}

// ─── published-forecast.schema.json ───────────────────────────────────────────
/**
 * AUTO-GENERATED — do not edit by hand.
 * Run `npm run generate:types` after schema changes.
 * Source: tools/generate-types.mjs
 */

/**
 * GO: hard rules pass, score ≥70. MARGINAL: hard rules pass, score 40–69. NO_GO: hard rule failure or score <40. UNKNOWN: insufficient data.
 */
export type RecommendationStatus = 'GO' | 'MARGINAL' | 'NO_GO' | 'UNKNOWN';

/**
 * Immutable presentation-ready daily forecast document published to S3. The mobile client renders this directly without reconstructing decision rules.
 */
export interface PublishedSpotForecast {
  schemaVersion: '1.0';
  spot: {
    spotId: string;
    name: string;
    region?: string;
    timezone: string;
  };
  /**
   * Calendar date in the spot's timezone (YYYY-MM-DD).
   */
  localDate: string;
  /**
   * UTC timestamp when this document was generated.
   */
  generatedAt: string;
  /**
   * UTC timestamp after which the document should be refreshed.
   */
  expiresAt: string;
  daylight: {
    sunriseUtc: string;
    sunsetUtc: string;
    civilTwilightBeginUtc: string;
    civilTwilightEndUtc: string;
  };
  /**
   * All tide high/low events for the local date.
   */
  tideEvents: {
    timeUtc: string;
    type: 'HIGH' | 'LOW';
    heightFeet: number;
    station: string;
    datum: string;
  }[];
  /**
   * The decision engine output for this day.
   */
  assessment: {
    status: RecommendationStatus;
    bestWindow: SessionWindow | null;
    alternatives: SessionWindow[];
    /**
     * Hard-rule failures that produced a NO_GO status.
     */
    blockingConstraints?: string[];
    /**
     * Non-blocking conditions the user should be aware of.
     */
    warnings?: string[];
    /**
     * 15-minute assessment points for the graph.
     *
     * @minItems 1
     */
    timelinePoints: [TimelinePoint, ...TimelinePoint[]];
  };
  /**
   * Attribution records for each data source used.
   */
  sourceAttribution?: {
    provider: string;
    retrievedAt: string;
    url?: string;
    attribution?: string;
  }[];
  /**
   * Monotonically increasing run identifier (e.g. ISO 8601 UTC run time).
   */
  revision: string;
}
export interface SessionWindow {
  startUtc: string;
  endUtc: string;
  status: RecommendationStatus;
  score: number;
  weakestSlotScore?: number;
  lowTideUtc: string;
  reasons: string[];
  warnings?: string[];
  blockingConstraints?: string[];
  scoreComponents?: ScoreComponents;
}
/**
 * Breakdown of the window score by factor.
 */
export interface ScoreComponents {
  windSpeed: number;
  windDirection: number;
  tideAlignment: number;
  gustStability: number;
  weather: number;
  confidence: number;
}
export interface TimelinePoint {
  timeUtc: string;
  status: RecommendationStatus;
  score: number | null;
  windSpeedKnots?: number | null;
  windDirectionDegrees?: number | null;
  windClassification?:
    'DIRECT_ONSHORE' | 'SIDE_ONSHORE' | 'CROSS_SHORE' | 'SIDE_OFFSHORE' | 'OFFSHORE';
  gustSpeedKnots?: number | null;
  tideHeightFeet?: number | null;
  temperatureCelsius?: number | null;
  probabilityOfPrecipitation?: number | null;
  isDaylight?: boolean;
  isInBestWindow?: boolean;
  interpolatedFields?: string[];
  dataSource?: 'OBSERVED' | 'FORECAST' | 'INTERPOLATED' | 'CALCULATED' | 'MISSING';
  confidence?: number | null;
}

// ─── normalized-timeline.schema.json ───────────────────────────────────────────
/**
 * AUTO-GENERATED — do not edit by hand.
 * Run `npm run generate:types` after schema changes.
 * Source: tools/generate-types.mjs
 */

/**
 * Canonicalized 15-minute timeline combining NWS wind/weather, NOAA tide, and solar data. Persisted to S3 as an immutable raw-pipeline artifact prior to assessment.
 */
export interface Normalized15MinuteTimeline {
  schemaVersion: '1.0';
  spotId: string;
  /**
   * Calendar date in the spot's timezone (YYYY-MM-DD).
   */
  localDate: string;
  /**
   * UTC timestamp when this timeline was generated.
   */
  generatedAt: string;
  /**
   * 15-minute timeline slots, sorted ascending by timeUtc. Each slot represents the period [timeUtc, timeUtc+15min).
   *
   * @minItems 1
   */
  slots: [TimelineSlot, ...TimelineSlot[]];
  /**
   * Source metadata for each provider contributing to this timeline.
   */
  sources: {
    nws: SourceRecord;
    noaaTide: SourceRecord;
    solar: SourceRecord;
  };
}
export interface TimelineSlot {
  /**
   * UTC-aligned slot start (inclusive). Slots are 15 minutes wide.
   */
  timeUtc: string;
  windSpeedKnots?: number | null;
  windDirectionDegrees?: number | null;
  gustSpeedKnots?: number | null;
  tideHeightFeet?: number | null;
  temperatureCelsius?: number | null;
  probabilityOfPrecipitation?: number | null;
  probabilityOfThunder?: number | null;
  skyCoverPercent?: number | null;
  isDaylight?: boolean | null;
  dataSource?: 'OBSERVED' | 'FORECAST' | 'INTERPOLATED' | 'CALCULATED' | 'MISSING';
  /**
   * Names of fields whose values were interpolated for this slot.
   */
  interpolatedFields?: string[];
  /**
   * Composite data confidence for this slot (1.0 = full confidence).
   */
  confidence?: number | null;
}
export interface SourceRecord {
  provider: string;
  /**
   * UTC timestamp when this source was fetched.
   */
  retrievedAt: string;
  validFrom?: string;
  validTo?: string;
  isStale?: boolean;
  attribution?: string;
}
