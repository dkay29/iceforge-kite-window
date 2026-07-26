import type { NoaaTideResponse } from '../types.js';
import { ProviderError } from '../nws/nwsProvider.js';

export { ProviderError };

/**
 * Contract for the NOAA CO-OPS tide prediction provider.
 *
 * Implementations must:
 * - Validate the raw API response before returning.
 * - Preserve raw attribution and timestamps.
 * - Throw `ProviderError` on HTTP errors, NOAA error envelopes, or malformed responses.
 * - Use captured fixtures for tests (no live network required).
 */
export interface TideProvider {
  /**
   * Fetch hi-lo tide predictions for the given station and date range.
   *
   * @param stationId - NOAA CO-OPS station identifier (e.g. '8447504').
   * @param beginDate - First date in YYYYMMDD format (LST/LDT).
   * @param endDate   - Last date in YYYYMMDD format (LST/LDT).
   * @param datum     - Tidal datum (e.g. 'MLLW').
   * @throws {ProviderError} on any retrieval or validation failure.
   */
  fetchHiloPredictions(
    stationId: string,
    beginDate: string,
    endDate: string,
    datum: string,
  ): Promise<NoaaTideResponse>;
}
