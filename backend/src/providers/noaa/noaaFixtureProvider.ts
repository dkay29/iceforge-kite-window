import fs from 'node:fs';
import path from 'node:path';
import type { NoaaTideResponse, NoaaTideErrorResponse } from '../types.js';
import { ProviderError } from '../nws/nwsProvider.js';
import type { TideProvider } from './noaaProvider.js';

/**
 * NOAA CO-OPS tide provider that replays captured JSON fixtures from disk.
 *
 * Use this in tests and local development to avoid live NOAA API calls.
 *
 * Fixture files are resolved relative to the provided `fixturesDir`.
 * The default lookup key is `predictions-{stationId}-hilo-{beginDate}.json`.
 * Override with a custom key map when multiple fixtures are needed.
 *
 * @example
 * const provider = new NoaaFixtureProvider(
 *   path.join(import.meta.dirname, 'fixtures'),
 * );
 * const data = await provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW');
 */
export class NoaaFixtureProvider implements TideProvider {
  constructor(
    private readonly fixturesDir: string,
    /** Override specific station+date combinations with a named fixture file. */
    private readonly overrides: Map<string, string> = new Map(),
  ) {}

  async fetchHiloPredictions(
    stationId: string,
    beginDate: string,
    endDate: string,
    datum: string,
  ): Promise<NoaaTideResponse> {
    void endDate;
    void datum;

    const key = `${stationId}-${beginDate}`;
    const fileName = this.overrides.get(key) ?? `predictions-${stationId}-hilo-${beginDate}.json`;
    const filePath = path.join(this.fixturesDir, fileName);

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new ProviderError(
        'NOAA',
        `fixture not found: ${filePath}`,
        err instanceof Error ? err : undefined,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ProviderError(
        'NOAA',
        `fixture is not valid JSON: ${filePath}`,
        err instanceof Error ? err : undefined,
      );
    }

    return validateNoaaTideResponse(parsed, filePath);
  }
}

function validateNoaaTideResponse(raw: unknown, source: string): NoaaTideResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProviderError('NOAA', `malformed response: expected object (${source})`);
  }

  const obj = raw as Record<string, unknown>;

  // NOAA returns an error envelope instead of a 4xx status on some failures.
  if ('error' in obj) {
    const errEnv = obj as unknown as NoaaTideErrorResponse;
    const message = errEnv.error?.message ?? 'unknown error';
    throw new ProviderError('NOAA', `API error: ${message} (${source})`);
  }

  if (!Array.isArray(obj['predictions'])) {
    throw new ProviderError('NOAA', `malformed response: missing 'predictions' array (${source})`);
  }

  return raw as NoaaTideResponse;
}
