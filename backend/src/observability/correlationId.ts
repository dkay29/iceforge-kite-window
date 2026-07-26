/**
 * Correlation ID utilities.
 *
 * A correlation ID is a short unique string that tags every log record and
 * response header across the full request lifecycle: API handler → pipeline
 * → provider adapters → publication.
 *
 * Sources (in priority order):
 *   1. Client-supplied X-Correlation-Id request header (allows end-to-end
 *      tracing from mobile client through API Gateway to backend).
 *   2. API Gateway request ID (event.requestContext.requestId).
 *   3. Synthesized ID using crypto.randomUUID().
 *
 * The resolved ID is included in every response via the X-Correlation-Id
 * header so the client can reference it in support requests.
 */

import { randomUUID } from 'node:crypto';

/** HTTP header name (lowercase, per API Gateway v2 convention). */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Generate a new correlation ID using crypto.randomUUID().
 * Output is a RFC 4122 version 4 UUID.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Extract a correlation ID from incoming HTTP headers.
 *
 * API Gateway v2 lowercases all header names before delivering the event,
 * so we look for 'x-correlation-id' (lowercase).
 *
 * @param headers - Event headers object (may be undefined).
 * @returns The client-supplied ID, or undefined when not present.
 */
export function extractCorrelationId(
  headers: Record<string, string | undefined> | undefined,
): string | undefined {
  return headers?.[CORRELATION_ID_HEADER];
}

/**
 * Resolve the correlation ID to use for a request:
 *   1. Client header (X-Correlation-Id)
 *   2. API Gateway request ID
 *   3. Generated UUID
 *
 * @param headers   - Incoming HTTP headers.
 * @param requestId - API Gateway or Lambda request context ID.
 */
export function resolveCorrelationId(
  headers: Record<string, string | undefined> | undefined,
  requestId?: string,
): string {
  return extractCorrelationId(headers) ?? requestId ?? generateCorrelationId();
}
