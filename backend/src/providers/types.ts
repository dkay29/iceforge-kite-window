/**
 * Raw provider response types.
 *
 * These types describe exactly what the external APIs return, before any
 * unit conversion or domain mapping. Adapters consume these types and
 * produce normalized domain values.
 */

// ─── NWS Grid Data ────────────────────────────────────────────────────────────

/**
 * A single value with a ISO 8601 interval validTime.
 * Duration intervals look like "2026-07-26T05:00:00+00:00/PT4H".
 */
export interface NwsGridValue {
  validTime: string;
  value: number | null;
}

export interface NwsGridProperty {
  uom?: string;
  values: NwsGridValue[];
}

/**
 * Subset of the NWS gridpoints/{office}/{x},{y} response that the pipeline
 * uses. Additional properties returned by the API are not modelled here.
 */
export interface NwsGridDataResponse {
  properties: {
    updateTime: string;
    validTimes: string;
    windDirection: NwsGridProperty;
    windSpeed: NwsGridProperty;
    windGust: NwsGridProperty;
    skyCover: NwsGridProperty;
    probabilityOfPrecipitation: NwsGridProperty;
    probabilityOfThunder: NwsGridProperty;
    temperature: NwsGridProperty;
  };
}

// ─── NOAA CO-OPS Tide Predictions ─────────────────────────────────────────────

export interface NoaaTidePrediction {
  /** "YYYY-MM-DD HH:mm" in LST/LDT (local standard / daylight time) */
  t: string;
  /** Height as decimal string, in the requested units */
  v: string;
  /** H = high tide, L = low tide */
  type: 'H' | 'L';
}

export interface NoaaTideResponse {
  predictions: NoaaTidePrediction[];
}

/** Error envelope returned by the NOAA CO-OPS API on failure */
export interface NoaaTideErrorResponse {
  error: { message: string };
}
