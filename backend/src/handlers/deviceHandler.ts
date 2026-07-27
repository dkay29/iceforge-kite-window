/**
 * Device registration API Lambda handler.
 *
 * Routes (all require Cognito JWT via API Gateway Authorizer):
 *   PUT    /me/devices/{deviceId}
 *   DELETE /me/devices/{deviceId}
 *
 * PUT behaviour:
 *   200  — device registered or token replaced.
 *   422  — request body fails validation.
 *
 * DELETE behaviour:
 *   204  — device removed (idempotent; deleting a non-existent key is silent).
 *
 * Token replacement: PUT with the same deviceId overwrites the stored token while
 * preserving the original registeredAt timestamp.
 *
 * Invalid token cleanup: callers (e.g. fan-out Lambda) DELETE the device key
 * when the push provider reports the token as invalid or expired.
 *
 * S3 key: users/{cognitoSub}/devices/{deviceId}.json
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { userDeviceKey } from '../s3Keys.js';
import type { DeviceRegistration } from '../generated/schema-types.js';
import { resolveCorrelationId, CORRELATION_ID_HEADER } from '../observability/correlationId.js';
import { createLogger } from '../observability/logger.js';

// ─── S3 store interface ───────────────────────────────────────────────────────

export interface DeviceStore {
  /** Return the parsed JSON body, or null when the key does not exist. */
  get(key: string): Promise<unknown | null>;
  /** Write JSON unconditionally. */
  put(key: string, body: unknown): Promise<void>;
  /** Delete the object. Silently succeeds when the key does not exist. */
  delete(key: string): Promise<void>;
  /** List all object keys under a key prefix (used for fan-out). */
  listKeys(prefix: string): Promise<string[]>;
}

// ─── Error codes ──────────────────────────────────────────────────────────────

const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

// ─── Validation ───────────────────────────────────────────────────────────────

interface DeviceRegistrationInput {
  platform: 'apns' | 'fcm';
  token: string;
}

function validateBody(raw: unknown): raw is DeviceRegistrationInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  if (obj['platform'] !== 'apns' && obj['platform'] !== 'fcm') return false;
  if (typeof obj['token'] !== 'string' || obj['token'].length === 0) return false;
  if (obj['token'].length > 4096) return false;
  return true;
}

// ─── Handler factory ──────────────────────────────────────────────────────────

export function createDeviceHandler(deps: { store: DeviceStore }) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    const requestId = event.requestContext?.requestId ?? 'unknown';
    const correlationId = resolveCorrelationId(event.headers, requestId);
    const log = createLogger({ correlationId, handler: 'deviceHandler' });

    try {
      return await handleDevice(event, deps.store, correlationId, log);
    } catch (err) {
      log.error('Unhandled error in deviceHandler', { error: String(err) });
      return internalError(correlationId);
    }
  };
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async function handleDevice(
  event: APIGatewayProxyEventV2,
  store: DeviceStore,
  correlationId: string,
  log: ReturnType<typeof createLogger>,
): Promise<APIGatewayProxyResultV2> {
  // Extract Cognito sub from the JWT claims injected by API Gateway Authorizer.
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

  // Extract deviceId from path parameters
  const pathParams = event.pathParameters ?? {};
  const deviceId = pathParams['deviceId'];
  if (typeof deviceId !== 'string' || !deviceId) {
    return errorResponse(
      400,
      ERROR_CODES.BAD_REQUEST,
      'Missing deviceId path parameter',
      false,
      correlationId,
    );
  }

  const method = event.requestContext.http.method.toUpperCase();
  const key = userDeviceKey(userId, deviceId);
  const userLog = log.child({ userId, deviceId });

  if (method === 'PUT') {
    return handlePut(store, key, userId, deviceId, event.body ?? '', correlationId, userLog);
  }
  if (method === 'DELETE') {
    return handleDelete(store, key, correlationId, userLog);
  }

  return errorResponse(
    405,
    'METHOD_NOT_ALLOWED',
    `Method ${method} not allowed`,
    false,
    correlationId,
  );
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

async function handlePut(
  store: DeviceStore,
  key: string,
  userId: string,
  deviceId: string,
  rawBody: string,
  correlationId: string,
  log: ReturnType<typeof createLogger>,
): Promise<APIGatewayProxyResultV2> {
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

  if (!validateBody(parsed)) {
    return errorResponse(
      422,
      ERROR_CODES.VALIDATION_ERROR,
      'Request body must include platform ("apns" or "fcm") and a non-empty token string',
      false,
      correlationId,
    );
  }

  const now = new Date().toISOString();

  // Preserve registeredAt from an existing record (token replacement scenario)
  let registeredAt = now;
  const existing = await store.get(key);
  if (
    existing !== null &&
    typeof existing === 'object' &&
    !Array.isArray(existing) &&
    typeof (existing as Record<string, unknown>)['registeredAt'] === 'string'
  ) {
    registeredAt = (existing as Record<string, unknown>)['registeredAt'] as string;
  }

  const record: DeviceRegistration = {
    schemaVersion: 1,
    deviceId,
    platform: parsed.platform,
    token: parsed.token,
    userId,
    registeredAt,
    updatedAt: now,
  };

  await store.put(key, record);
  log.info('Device registered', { platform: parsed.platform });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      [CORRELATION_ID_HEADER]: correlationId,
    },
    body: JSON.stringify(record),
  };
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

async function handleDelete(
  store: DeviceStore,
  key: string,
  correlationId: string,
  log: ReturnType<typeof createLogger>,
): Promise<APIGatewayProxyResultV2> {
  await store.delete(key);
  log.info('Device removed');

  return {
    statusCode: 204,
    headers: { [CORRELATION_ID_HEADER]: correlationId },
  };
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
