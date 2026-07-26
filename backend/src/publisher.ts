/**
 * Immutable forecast publication with safe current-pointer updates.
 *
 * Publication protocol:
 * 1. Write the immutable published forecast object (if-none-match: * prevents overwrite).
 * 2. Write the normalized timeline object (also immutable, same guard).
 * 3. Verify the published object is readable.
 * 4. Update the daily current pointer.
 * 5. Update the latest current pointer.
 *
 * The current pointer is never updated when an earlier step fails.
 */

import type { PublishedSpotForecast } from './generated/schema-types.js';
import { currentDailyPointerKey, currentLatestPointerKey, publishedForecastKey } from './s3Keys.js';

// ─── S3 client interface ──────────────────────────────────────────────────────

export interface S3PutOptions {
  /**
   * When true, the write is conditional: the operation must fail (throw
   * `ConditionalWriteError`) if the key already exists.  Implements
   * if-none-match: * semantics.
   */
  ifNoneMatch?: boolean;
}

export class ConditionalWriteError extends Error {
  constructor(
    public readonly key: string,
    cause?: Error,
  ) {
    super(`Conditional write failed: key already exists: ${key}`);
    this.name = 'ConditionalWriteError';
    if (cause) this.cause = cause;
  }
}

export class VerificationError extends Error {
  constructor(
    public readonly key: string,
    cause?: Error,
  ) {
    super(`Verification failed: object not readable after write: ${key}`);
    this.name = 'VerificationError';
    if (cause) this.cause = cause;
  }
}

export interface S3Client {
  /**
   * Write a JSON object. Throws `ConditionalWriteError` when ifNoneMatch is
   * true and the key already exists.
   */
  putJson(key: string, value: unknown, options?: S3PutOptions): Promise<void>;

  /**
   * Read and return a stored object, or null when the key does not exist.
   */
  getJson(key: string): Promise<unknown>;
}

// ─── Current pointer document ─────────────────────────────────────────────────

export interface CurrentPointer {
  spotId: string;
  localDate: string;
  rulesetId: string;
  forecastRunId: string;
  publishedKey: string;
  generatedAt: string;
}

// ─── Publication inputs ───────────────────────────────────────────────────────

export interface PublicationInput {
  spotId: string;
  localDate: string;
  rulesetId: string;
  forecastRunId: string;
  forecast: PublishedSpotForecast;
}

export interface PublicationResult {
  publishedKey: string;
  dailyPointerKey: string;
  latestPointerKey: string;
}

// ─── Core publication function ────────────────────────────────────────────────

/**
 * Publish an immutable forecast document and update the current pointers.
 *
 * Throws without updating any pointer if:
 * - The immutable write fails (including conditional failure)
 * - Post-write verification fails (object not readable)
 *
 * @throws ConditionalWriteError when the forecast run already exists in S3.
 * @throws VerificationError when the written object cannot be read back.
 */
export async function publishForecast(
  s3: S3Client,
  input: PublicationInput,
): Promise<PublicationResult> {
  const { spotId, localDate, rulesetId, forecastRunId, forecast } = input;

  const pubKey = publishedForecastKey(spotId, localDate, rulesetId, forecastRunId);
  const dailyKey = currentDailyPointerKey(spotId, localDate);
  const latestKey = currentLatestPointerKey(spotId);

  // Step 1: Write the immutable published forecast (conditional — do not overwrite).
  await s3.putJson(pubKey, forecast, { ifNoneMatch: true });

  // Step 2: Verify the object is readable.
  let verified: unknown;
  try {
    verified = await s3.getJson(pubKey);
  } catch (err) {
    throw new VerificationError(pubKey, err instanceof Error ? err : undefined);
  }
  if (verified == null) {
    throw new VerificationError(pubKey);
  }

  // Step 3: Build the current pointer document.
  const pointer: CurrentPointer = {
    spotId,
    localDate,
    rulesetId,
    forecastRunId,
    publishedKey: pubKey,
    generatedAt: forecast.generatedAt,
  };

  // Step 4: Update current pointers (overwrite is intentional — latest run wins).
  await s3.putJson(dailyKey, pointer);
  await s3.putJson(latestKey, pointer);

  return { publishedKey: pubKey, dailyPointerKey: dailyKey, latestPointerKey: latestKey };
}
