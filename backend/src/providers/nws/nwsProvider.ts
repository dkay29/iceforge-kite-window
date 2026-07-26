import type { NwsGridDataResponse } from '../types.js';

/**
 * Contract for the NWS weather data provider.
 *
 * Implementations must:
 * - Validate the raw API response before returning.
 * - Preserve raw attribution and the updateTime / validTimes timestamps.
 * - Throw `ProviderError` on HTTP errors, timeouts, or malformed responses.
 * - Use captured fixtures for tests (no live network required).
 */
export interface WeatherProvider {
  /**
   * Fetch grid-data for the given NWS office and grid cell.
   * Returns the raw typed response; unit conversion is the adapter's job.
   *
   * @throws {ProviderError} on any retrieval or validation failure.
   */
  fetchGridData(office: string, gridX: number, gridY: number): Promise<NwsGridDataResponse>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly reason: string,
    cause?: Error,
  ) {
    super(`[${provider}] ${reason}`);
    this.name = 'ProviderError';
    if (cause) this.cause = cause;
  }
}
