/**
 * User-preferences API Lambda handler.
 *
 * Routes (all require Cognito JWT via API Gateway Authorizer):
 *   GET  /me/preferences
 *   PUT  /me/preferences
 *
 * GET behaviour:
 *   200  — current preferences JSON with ETag header.
 *   304  — not modified when client sends matching If-None-Match ETag.
 *   404  — no preferences stored yet for this user.
 *
 * PUT behaviour:
 *   200  — preferences updated; new ETag in response.
 *   409  — ETag conflict (If-Match header does not match stored ETag).
 *   422  — request body fails schema validation.
 *
 * ETags come from the S3 object ETag (MD5 of the stored JSON).
 * Clients must round-trip the ETag via If-Match to detect concurrent updates.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { userPreferencesKey } from '../s3Keys.js';
import type { UserPreferences } from '../generated/schema-types.js';
import { resolveCorrelationId, CORRELATION_ID_HEADER } from '../observability/correlationId.js';
import { createLogger, recordMetric } from '../observability/logger.js';

// ─── S3 reader/writer interface ───────────────────────────────────────────────

export interface S3PreferencesStore {
  /**
   * Return the parsed JSON and its S3 ETag, or null when the key does not exist.
   */
  getWithEtag(key: string): Promise<{ body: unknown; etag: string } | null>;

  /**
   * Write JSON conditionally.
   * @param key    S3 object key.
   * @param body   Value to serialise and store.
   * @param ifMatch When provided, the write is conditional on the current object
   *               ETag matching this value.  Throws EtagConflictError on mismatch.
   * @returns The new ETag assigned by S3.
   */
  putJson(key: string, body: unknown, ifMatch?: string): Promise<string>;
}

// ─── ETag conflict error ──────────────────────────────────────────────────────

export class EtagConflictError extends Error {
  constructor() {
    super('ETag conflict: object was modified by another request');
    this.name = 'EtagConflictError';
  }
}

// ─── Error codes ──────────────────────────────────────────────────────────────

const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  PREFERENCES_NOT_FOUND: 'PREFERENCES_NOT_FOUND',
  ETAG_CONFLICT: 'ETAG_CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// ─── Validation ───────────────────────────────────────────────────────────────

/** Validate the shape of a PUT body (minimal structural check). */
function validatePreferencesBody(
  raw: unknown,
): raw is Omit<UserPreferences, 'userId' | 'updatedAt' | 'schemaVersion'> &
  Partial<Pick<UserPreferences, 'userId' | 'updatedAt' | 'schemaVersion'>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj['windSpeed'] !== 'object' || obj['windSpeed'] === null) return false;
  if (typeof obj['windDirection'] !== 'object' || obj['windDirection'] === null) return false;
  if (typeof obj['gust'] !== 'object' || obj['gust'] === null) return false;
  const ws = obj['windSpeed'] as Record<string, unknown>;
  if (typeof ws['minimumUsableKnots'] !== 'number') return false;
  if (typeof ws['preferredMinKnots'] !== 'number') return false;
  if (typeof ws['preferredMaxKnots'] !== 'number') return false;
  if (typeof ws['absoluteMaxKnots'] !== 'number') return false;
  const wd = obj['windDirection'] as Record<string, unknown>;
  if (!Array.isArray(wd['acceptedSectors']) || wd['acceptedSectors'].length === 0) return false;
  const gust = obj['gust'] as Record<string, unknown>;
  if (typeof gust['maxGustFactorRatio'] !== 'number') return false;
  return true;
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createPreferencesHandler(deps: { store: S3PreferencesStore }) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId ?? 'unknown';
    const correlationId = resolveCorrelationId(event.headers, requestId);
    const log = createLogger({ correlationId, handler: 'preferencesHandler' });

    try {
      return await handlePreferences(event, deps.store, correlationId, log);
    } catch (err) {
      log.error('Unhandled error in preferencesHandler', { error: String(err) });
      recordMetric(log, 'refresh_failure', 1);
      return internalError(correlationId);
    }
  };
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handlePreferences(
  event: APIGatewayProxyEventV2,
  store: S3PreferencesStore,
  correlationId: string,
  log: ReturnType<typeof createLogger>,
): Promise<APIGatewayProxyResultV2> {
  // Extract Cognito sub from the JWT claims injected by API Gateway Authorizer.
  // The authorizer property is present at runtime but not in the base type.
  const ctx = event.requestContext as unknown as Record<string, unknown>;
  const authorizer = ctx['authorizer'] as Record<string, unknown> | undefined;
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  const claims = jwt?.['claims'] as Record<string, unknown> | undefined;
  const userId = claims?.['sub'];
  if (typeof userId !== 'string' || !userId) {
    return errorResponse(
      401,
      'UNAUTHORIZED',
      'Missing or invalid authorization',
      false,
      correlationId,
    );
  }

  const method = event.requestContext.http.method.toUpperCase();
  const key = userPreferencesKey(userId);
  const userLog = log.child({ userId });

  if (method === 'GET') {
    return handleGet(store, key, event.headers, correlationId, userLog);
  }
  if (method === 'PUT') {
    return handlePut(store, key, event.body ?? '', event.headers, correlationId, userLog);
  }

  return errorResponse(
    405,
    'METHOD_NOT_ALLOWED',
    `Method ${method} not allowed`,
    false,
    correlationId,
  );
}

// ─── GET ──────────────────────────────────────────────────────────────────────

async function handleGet(
  store: S3PreferencesStore,
  key: string,
  headers: Record<string, string | undefined>,
  correlationId: string,
  log: ReturnType<typeof createLogger>,
): Promise<APIGatewayProxyResultV2> {
  const result = await store.getWithEtag(key);

  if (result === null) {
    return errorResponse(
      404,
      ERROR_CODES.PREFERENCES_NOT_FOUND,
      'No preferences found for this user',
      true,
      correlationId,
    );
  }

  const { body, etag } = result;
  const quotedEtag = `"${etag}"`;

  // 304 when client ETag matches
  const clientEtag = headers['if-none-match'];
  if (clientEtag === quotedEtag) {
    log.info('Preferences cache hit (304)');
    return {
      statusCode: 304,
      headers: { ETag: quotedEtag, [CORRELATION_ID_HEADER]: correlationId },
    };
  }

  log.info('Preferences served');
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      ETag: quotedEtag,
      'Cache-Control': 'private, no-store',
      [CORRELATION_ID_HEADER]: correlationId,
    },
    body: JSON.stringify(body),
  };
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

async function handlePut(
  store: S3PreferencesStore,
  key: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
  correlationId: string,
  log: ReturnType<typeof createLogger>,
): Promise<APIGatewayProxyResultV2> {
  // Parse body
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return errorResponse(
      400,
      ERROR_CODES.BAD_REQUEST,
      'Request body is not valid JSON',
      false,
      correlationId,
    );
  }

  // Validate structure
  if (!validatePreferencesBody(parsed)) {
    return errorResponse(
      422,
      ERROR_CODES.VALIDATION_ERROR,
      'Request body does not match the required preferences schema',
      false,
      correlationId,
    );
  }

  // Build the stored document — server sets schemaVersion, userId, updatedAt
  // We need to get userId from the key context. Extract from `parsed` or re-derive.
  // The userId is embedded in `key`; retrieve it from the existing result if available.
  const body = parsed as Record<string, unknown>;

  // The client may not supply userId/schemaVersion/updatedAt; server always overwrites them.
  // userId is derived from the S3 key path segment: users/{cognitoSub}/preferences.json
  const storedUserId = String(key.split('/')[1] ?? '');
  const notifications =
    body['notifications'] !== undefined
      ? (body['notifications'] as NonNullable<UserPreferences['notifications']>)
      : undefined;
  const preferences: UserPreferences = {
    schemaVersion: 1,
    userId: storedUserId,
    updatedAt: new Date().toISOString(),
    windSpeed: body['windSpeed'] as UserPreferences['windSpeed'],
    windDirection: body['windDirection'] as UserPreferences['windDirection'],
    gust: body['gust'] as UserPreferences['gust'],
    ...(notifications !== undefined && { notifications }),
  };

  // Extract If-Match ETag for conditional write
  const ifMatch = headers['if-match'];
  const condIfMatch = ifMatch !== undefined ? ifMatch.replace(/^"|"$/g, '') : undefined;

  try {
    const newEtag = await store.putJson(key, preferences, condIfMatch);
    const quotedEtag = `"${newEtag}"`;
    log.info('Preferences updated');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ETag: quotedEtag,
        'Cache-Control': 'private, no-store',
        [CORRELATION_ID_HEADER]: correlationId,
      },
      body: JSON.stringify(preferences),
    };
  } catch (err) {
    if (err instanceof EtagConflictError) {
      log.warn('Preferences ETag conflict');
      return errorResponse(
        409,
        ERROR_CODES.ETAG_CONFLICT,
        'Preferences were modified by another request. Fetch the latest and retry.',
        true,
        correlationId,
      );
    }
    throw err;
  }
}

// ─── Error helpers ────────────────────────────────────────────────────────────

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
    body: JSON.stringify({ error: { code, message, requestId, retryable } }),
  };
}
