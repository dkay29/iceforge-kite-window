import fs from 'node:fs';
import path from 'node:path';
import type { NwsGridDataResponse } from '../types.js';
import { ProviderError } from './nwsProvider.js';
import type { WeatherProvider } from './nwsProvider.js';

/**
 * NWS weather provider that replays captured JSON fixtures from disk.
 *
 * Use this in tests and local development to avoid live NWS API calls.
 *
 * Fixture files are resolved relative to the provided `fixturesDir`.
 * The default lookup key is `griddata-{office}-{gridX}-{gridY}.json`.
 * Override with a custom key map when multiple fixtures are needed.
 *
 * @example
 * const provider = new NwsFixtureProvider(
 *   path.join(import.meta.dirname, 'fixtures'),
 * );
 * const data = await provider.fetchGridData('BOX', 107, 74);
 */
export class NwsFixtureProvider implements WeatherProvider {
  constructor(
    private readonly fixturesDir: string,
    /** Override specific grid cells with a named fixture file. */
    private readonly overrides: Map<string, string> = new Map(),
  ) {}

  async fetchGridData(office: string, gridX: number, gridY: number): Promise<NwsGridDataResponse> {
    const key = `${office}-${gridX}-${gridY}`;
    const fileName =
      this.overrides.get(key) ?? `griddata-${office}-${gridX}-${gridY}-20260726.json`;
    const filePath = path.join(this.fixturesDir, fileName);

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new ProviderError(
        'NWS',
        `fixture not found: ${filePath}`,
        err instanceof Error ? err : undefined,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ProviderError(
        'NWS',
        `fixture is not valid JSON: ${filePath}`,
        err instanceof Error ? err : undefined,
      );
    }

    return validateNwsGridData(parsed, filePath);
  }
}

function validateNwsGridData(raw: unknown, source: string): NwsGridDataResponse {
  if (typeof raw !== 'object' || raw === null) {
    throw new ProviderError(
      'NWS',
      `malformed response: expected object, got ${typeof raw} (${source})`,
    );
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['properties'] !== 'object' || obj['properties'] === null) {
    throw new ProviderError('NWS', `malformed response: missing 'properties' (${source})`);
  }

  const props = obj['properties'] as Record<string, unknown>;

  const requiredFields = [
    'updateTime',
    'validTimes',
    'windDirection',
    'windSpeed',
    'windGust',
    'skyCover',
    'probabilityOfPrecipitation',
    'probabilityOfThunder',
    'temperature',
  ] as const;

  for (const field of requiredFields) {
    if (!(field in props)) {
      throw new ProviderError('NWS', `malformed response: missing properties.${field} (${source})`);
    }
  }

  return raw as NwsGridDataResponse;
}
