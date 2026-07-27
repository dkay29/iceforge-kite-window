/**
 * Forecast service — fetches the daily published forecast from the API.
 *
 * The forecast is a presentation-ready document; no business logic runs
 * on the client. The service manages caching via ETag/If-None-Match.
 */

// ─── Domain types (mirrors backend PublishedSpotForecast) ─────────────────────

export type RecommendationStatus = 'GO' | 'MARGINAL' | 'NO_GO' | 'UNKNOWN';

export type WindClassification =
  'DIRECT_ONSHORE' | 'SIDE_ONSHORE' | 'CROSS_SHORE' | 'SIDE_OFFSHORE' | 'OFFSHORE';

export interface TimelinePoint {
  timeUtc: string;
  status: RecommendationStatus;
  score: number | null;
  windSpeedKnots?: number | null;
  windDirectionDegrees?: number | null;
  windClassification?: WindClassification | null;
  gustKnots?: number | null;
  tideHeightFeet?: number | null;
  isDaylight?: boolean;
}

export interface SessionWindow {
  startUtc: string;
  endUtc: string;
  status: RecommendationStatus;
  score: number;
  lowTideUtc: string;
  reasons: string[];
  warnings?: string[];
  blockingConstraints?: string[];
}

export interface TideEvent {
  timeUtc: string;
  type: 'HIGH' | 'LOW';
  heightFeet: number;
}

export interface DaylightInfo {
  sunriseUtc: string;
  sunsetUtc: string;
  civilTwilightBeginUtc: string;
  civilTwilightEndUtc: string;
}

export interface ForecastAssessment {
  status: RecommendationStatus;
  bestWindow: SessionWindow | null;
  alternatives: SessionWindow[];
  blockingConstraints?: string[];
  warnings?: string[];
  reasons?: string[];
}

export interface SpotForecast {
  schemaVersion: string;
  spot: { spotId: string; name: string; timezone: string; region?: string };
  localDate: string;
  generatedAt: string;
  expiresAt: string;
  daylight: DaylightInfo;
  tideEvents: TideEvent[];
  assessment: ForecastAssessment;
  timeline: { timelinePoints: TimelinePoint[] };
  revision: string;
}

export interface ForecastResult {
  forecast: SpotForecast;
  etag: string;
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

export interface ForecastHttpClient {
  get(
    path: string,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ForecastNotAvailableError extends Error {
  constructor(spotId: string, date: string) {
    super(`No forecast available for ${spotId} on ${date}`);
    this.name = 'ForecastNotAvailableError';
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ForecastService {
  readonly #http: ForecastHttpClient;
  readonly #basePath: string;

  constructor(http: ForecastHttpClient, basePath = '/spots') {
    this.#http = http;
    this.#basePath = basePath;
  }

  /**
   * Fetch the forecast for a spot on a given date.
   * @param spotId   Spot identifier (e.g. "west-dennis-beach-ma").
   * @param date     Local date in the spot's timezone (YYYY-MM-DD).
   * @param cachedEtag If provided, sends If-None-Match; returns null on 304.
   */
  async get(spotId: string, date: string, cachedEtag?: string): Promise<ForecastResult | null> {
    const path = `${this.#basePath}/${spotId}/forecast?date=${date}`;
    const headers: Record<string, string> = {};
    if (cachedEtag !== undefined) {
      headers['If-None-Match'] = cachedEtag;
    }

    const res = await this.#http.get(path, headers);

    if (res.status === 304) return null;
    if (res.status === 404) throw new ForecastNotAvailableError(spotId, date);
    if (res.status !== 200) {
      throw new Error(`Forecast request failed with status ${res.status}`);
    }

    const etag = (res.headers['etag'] ?? '').replace(/^"|"$/g, '');
    return { forecast: res.body as SpotForecast, etag };
  }
}
