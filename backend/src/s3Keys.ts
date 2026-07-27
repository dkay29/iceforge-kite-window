/**
 * Deterministic S3 key builders for all key families.
 *
 * Keys follow the convention documented in docs/s3-key-design.md.
 * All parameters are validated to reject empty strings and unsafe path characters.
 */

function assertSafe(value: string, name: string): void {
  if (!value) throw new Error(`${name} must not be empty`);
  if (/[#?]/.test(value)) throw new Error(`${name} contains illegal character: ${value}`);
}

// ─── Config ──────────────────────────────────────────────────────────────────

export function spotConfigCurrentKey(spotId: string): string {
  assertSafe(spotId, 'spotId');
  return `config/spots/${spotId}/current.json`;
}

export function spotConfigVersionKey(spotId: string, version: number): string {
  assertSafe(spotId, 'spotId');
  if (!Number.isInteger(version) || version < 1)
    throw new Error(`version must be a positive integer, got ${version}`);
  return `config/spots/${spotId}/versions/${version}.json`;
}

export function rulesetConfigCurrentKey(rulesetId: string): string {
  assertSafe(rulesetId, 'rulesetId');
  return `config/rulesets/${rulesetId}/current.json`;
}

export function rulesetConfigVersionKey(rulesetId: string, version: number): string {
  assertSafe(rulesetId, 'rulesetId');
  if (!Number.isInteger(version) || version < 1)
    throw new Error(`version must be a positive integer, got ${version}`);
  return `config/rulesets/${rulesetId}/versions/${version}.json`;
}

// ─── Raw provider responses ───────────────────────────────────────────────────

export function rawWeatherNwsKey(spotId: string, localDate: string, runTimestamp: string): string {
  assertSafe(spotId, 'spotId');
  assertSafe(localDate, 'localDate');
  assertSafe(runTimestamp, 'runTimestamp');
  return `raw/weather/provider=nws/spot=${spotId}/date=${localDate}/run=${runTimestamp}.json`;
}

export function rawTideNoaaKey(spotId: string, localDate: string, runTimestamp: string): string {
  assertSafe(spotId, 'spotId');
  assertSafe(localDate, 'localDate');
  assertSafe(runTimestamp, 'runTimestamp');
  return `raw/tide/provider=noaa-coops/spot=${spotId}/date=${localDate}/run=${runTimestamp}.json`;
}

// ─── Normalized timeline ──────────────────────────────────────────────────────

export function normalizedTimelineKey(
  spotId: string,
  localDate: string,
  forecastRunId: string,
): string {
  assertSafe(spotId, 'spotId');
  assertSafe(localDate, 'localDate');
  assertSafe(forecastRunId, 'forecastRunId');
  return `normalized/spot=${spotId}/date=${localDate}/run=${forecastRunId}.json`;
}

// ─── Published forecast ───────────────────────────────────────────────────────

export function publishedForecastKey(
  spotId: string,
  localDate: string,
  rulesetId: string,
  forecastRunId: string,
): string {
  assertSafe(spotId, 'spotId');
  assertSafe(localDate, 'localDate');
  assertSafe(rulesetId, 'rulesetId');
  assertSafe(forecastRunId, 'forecastRunId');
  return `published/spot=${spotId}/date=${localDate}/ruleset=${rulesetId}/run=${forecastRunId}.json`;
}

// ─── Current pointers ─────────────────────────────────────────────────────────

export function currentDailyPointerKey(spotId: string, localDate: string): string {
  assertSafe(spotId, 'spotId');
  assertSafe(localDate, 'localDate');
  return `current/spot=${spotId}/date=${localDate}/default.json`;
}

export function currentLatestPointerKey(spotId: string): string {
  assertSafe(spotId, 'spotId');
  return `current/spot=${spotId}/latest.json`;
}

// ─── User data ────────────────────────────────────────────────────────────────

export function userPreferencesKey(cognitoSub: string): string {
  assertSafe(cognitoSub, 'cognitoSub');
  return `users/${cognitoSub}/preferences.json`;
}

export function userDeviceKey(cognitoSub: string, deviceId: string): string {
  assertSafe(cognitoSub, 'cognitoSub');
  assertSafe(deviceId, 'deviceId');
  return `users/${cognitoSub}/devices/${deviceId}.json`;
}

// ─── Notification deduplication ───────────────────────────────────────────────

/**
 * Marker object written after a fan-out run completes. Its presence indicates
 * that notifications for this forecast run have already been dispatched.
 *
 * Example: notifications/spot=west-dennis-beach-ma/date=2026-07-26/run=2026-07-26T18:00:00Z/sent.json
 */
export function notificationSentKey(
  spotId: string,
  localDate: string,
  forecastRunId: string,
): string {
  assertSafe(spotId, 'spotId');
  assertSafe(localDate, 'localDate');
  assertSafe(forecastRunId, 'forecastRunId');
  return `notifications/spot=${spotId}/date=${localDate}/run=${forecastRunId}/sent.json`;
}
