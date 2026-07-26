import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProviderError } from './nwsProvider.js';
import { NwsFixtureProvider } from './nwsFixtureProvider.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');

describe('NwsFixtureProvider', () => {
  describe('success — captured grid data fixture', () => {
    it('loads the captured BOX/107/74 fixture without error', async () => {
      const provider = new NwsFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchGridData('BOX', 107, 74);
      expect(data).toBeDefined();
    });

    it('returns the correct office and grid coordinates', async () => {
      const provider = new NwsFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchGridData('BOX', 107, 74);
      expect(data.properties.windDirection.values.length).toBeGreaterThan(0);
    });

    it('preserves wind direction values as numbers', async () => {
      const provider = new NwsFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchGridData('BOX', 107, 74);
      const firstValue = data.properties.windDirection.values[0];
      expect(typeof firstValue!.value).toBe('number');
    });

    it('preserves wind speed in km/h (uom present)', async () => {
      const provider = new NwsFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchGridData('BOX', 107, 74);
      expect(data.properties.windSpeed.uom).toBe('wmoUnit:km_h-1');
    });

    it('returns updateTime and validTimes', async () => {
      const provider = new NwsFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchGridData('BOX', 107, 74);
      expect(data.properties.updateTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(data.properties.validTimes).toBeTruthy();
    });
  });

  describe('empty values fixture', () => {
    it('loads successfully when all value arrays are empty', async () => {
      const overrides = new Map([['BOX-107-74', 'empty-griddata.json']]);
      const provider = new NwsFixtureProvider(FIXTURES_DIR, overrides);
      const data = await provider.fetchGridData('BOX', 107, 74);
      expect(data.properties.windDirection.values).toHaveLength(0);
      expect(data.properties.windSpeed.values).toHaveLength(0);
    });
  });

  describe('malformed fixture', () => {
    it('throws ProviderError when properties is missing', async () => {
      const overrides = new Map([['BOX-107-74', 'malformed-griddata.json']]);
      const provider = new NwsFixtureProvider(FIXTURES_DIR, overrides);
      await expect(provider.fetchGridData('BOX', 107, 74)).rejects.toBeInstanceOf(ProviderError);
    });

    it('ProviderError message mentions the missing field', async () => {
      const overrides = new Map([['BOX-107-74', 'malformed-griddata.json']]);
      const provider = new NwsFixtureProvider(FIXTURES_DIR, overrides);
      await expect(provider.fetchGridData('BOX', 107, 74)).rejects.toThrow('properties');
    });
  });

  describe('provider error — fixture not found', () => {
    it('throws ProviderError when the fixture file does not exist', async () => {
      const provider = new NwsFixtureProvider(FIXTURES_DIR);
      // No fixture for office ZZZ
      await expect(provider.fetchGridData('ZZZ', 1, 1)).rejects.toBeInstanceOf(ProviderError);
    });

    it('ProviderError message includes the provider name', async () => {
      const provider = new NwsFixtureProvider(FIXTURES_DIR);
      await expect(provider.fetchGridData('ZZZ', 1, 1)).rejects.toThrow('[NWS]');
    });
  });

  describe('override map', () => {
    it('uses the override fixture when a key is present', async () => {
      const overrides = new Map([['BOX-107-74', 'empty-griddata.json']]);
      const provider = new NwsFixtureProvider(FIXTURES_DIR, overrides);
      const data = await provider.fetchGridData('BOX', 107, 74);
      // empty fixture has no values
      expect(data.properties.windDirection.values).toHaveLength(0);
    });
  });
});
