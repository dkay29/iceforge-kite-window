/**
 * Forecast API Lambda handler.
 *
 * Routes:
 *   GET /spots/{spotId}/forecast?date=YYYY-MM-DD
 *
 * Response behaviour:
 *   200  — published forecast JSON with cache and provenance headers.
 *   304  — not modified when client sends matching If-None-Match ETag.
 *   400  — malformed spotId or date parameter.
 *   404  — no forecast published for the requested spot/date.
 *   500  — internal error (S3 unavailable, corrupt data, etc.).
 *
 * Cache headers (per API contract):
 *   Cache-Control: public, max-age=300, stale-while-revalidate=900
 *   ETag: "<forecastRunId>"
 *   Last-Modified: <RFC 7231 date-time>
 *   X-Forecast-Generated-At: <ISO 8601 UTC>
 *   X-Forecast-Expires-At:   <ISO 8601 UTC>
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { currentDailyPointerKey } from '../s3Keys.js';
import type { CurrentPointer } from '../publisher.js';
import type { PublishedSpotForecast } from '../generated/schema-types.js';

// ─── S3 reader interface ──────────────────────────────────────────────────────

export interface S3Reader {
  /**
   * Return the parsed JSON object for the given key, or null when the key
   * does not exist.
   */
  getJson(key: string): Promise<unknown>;
}

// ─── Error codes ──────────────────────────────────────────────────────────────

const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  FORECAST_NOT_AVAILABLE: 'FORECAST_NOT_AVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// ─── Cache constants ──────────────────────────────────────────────────────────

const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=900';

// SPOT_ID_PATTERN: lowercase letters, digits, hyphens
const SPOT_ID_RE = /^[a-z0-9-]+$/;
// DATE_PATTERN: YYYY-MM-DD
const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Handler factory ──────────────────────────────────────────────────────────

/**
 * Create a forecast handler with injected dependencies.
 * This pattern allows unit testing without a live AWS S3 client.
 */
export function createForecastHandler(deps: { s3: S3Reader }) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const requestId =
      event.requestContext?.requestId ?? event.headers?.['x-request-id'] ?? 'unknown';

    try {
      return await handleForecast(event, deps.s3, requestId);
    } catch (err) {
      console.error('Unhandled error in forecastHandler', { requestId, err });
      return internalError(requestId);
    }
  };
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handleForecast(
  event: APIGatewayProxyEventV2,
  s3: S3Reader,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  // 1. Parse and validate path/query parameters
  const spotId = event.pathParameters?.['spotId'];
  const date = event.queryStringParameters?.['date'];

  if (!spotId || !SPOT_ID_RE.test(spotId)) {
    return badRequest('Missing or invalid spotId path parameter', requestId);
  }
  if (!date || !LOCAL_DATE_RE.test(date)) {
    return badRequest('Missing or invalid date query parameter; expected YYYY-MM-DD', requestId);
  }

  // 2. Load the current daily pointer from S3
  const pointerKey = currentDailyPointerKey(spotId, date);
  const rawPointer = await s3.getJson(pointerKey);

  if (rawPointer == null) {
    return notFound(`No forecast is available for spot "${spotId}" on ${date}`, requestId);
  }

  const pointer = rawPointer as CurrentPointer;

  // 3. Check If-None-Match ETag — headers are lowercase in API Gateway v2
  const clientEtag = event.headers?.['if-none-match'];
  const serverEtag = `"${pointer.forecastRunId}"`;

  if (clientEtag === serverEtag) {
    return { statusCode: 304, headers: { ETag: serverEtag } };
  }

  // 4. Load the immutable published forecast
  const rawForecast = await s3.getJson(pointer.publishedKey);
  if (rawForecast == null) {
    return notFound(`Forecast document missing from S3 for spot "${spotId}" on ${date}`, requestId);
  }

  const forecast = rawForecast as PublishedSpotForecast;

  // 5. Build response headers
  const lastModified = new Date(forecast.generatedAt).toUTCString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': CACHE_CONTROL,
    ETag: serverEtag,
    'Last-Modified': lastModified,
    'X-Forecast-Generated-At': forecast.generatedAt,
    'X-Forecast-Expires-At': forecast.expiresAt,
    'X-Request-Id': requestId,
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(forecast),
  };
}

// ─── Error response helpers ───────────────────────────────────────────────────

function badRequest(message: string, requestId: string): APIGatewayProxyResultV2 {
  return errorResponse(400, ERROR_CODES.BAD_REQUEST, message, false, requestId);
}

function notFound(message: string, requestId: string): APIGatewayProxyResultV2 {
  return errorResponse(404, ERROR_CODES.FORECAST_NOT_AVAILABLE, message, true, requestId);
}

function internalError(requestId: string): APIGatewayProxyResultV2 {
  return errorResponse(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    'An internal error occurred. Please retry.',
    true,
    requestId,
  );
}

function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  retryable: boolean,
  requestId: string,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    body: JSON.stringify({
      error: { code, message, requestId, retryable },
    }),
  };
}
