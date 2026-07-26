import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProviderError } from '../nws/nwsProvider.js';
import { NoaaFixtureProvider } from './noaaFixtureProvider.js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');

describe('NoaaFixtureProvider', () => {
  describe('success — captured predictions fixture', () => {
    it('loads the captured 8447504 fixture without error', async () => {
      const provider = new NoaaFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW');
      expect(data).toBeDefined();
    });

    it('returns a predictions array', async () => {
      const provider = new NoaaFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW');
      expect(Array.isArray(data.predictions)).toBe(true);
      expect(data.predictions.length).toBeGreaterThan(0);
    });

    it('preserves the H/L type field', async () => {
      const provider = new NoaaFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW');
      const types = data.predictions.map((p) => p.type);
      expect(types).toContain('H');
      expect(types).toContain('L');
    });

    it('preserves height as a string', async () => {
      const provider = new NoaaFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW');
      const first = data.predictions[0]!;
      expect(typeof first.v).toBe('string');
    });

    it('preserves the time string format', async () => {
      const provider = new NoaaFixtureProvider(FIXTURES_DIR);
      const data = await provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW');
      const first = data.predictions[0]!;
      // NOAA returns "YYYY-MM-DD HH:mm"
      expect(first.t).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });
  });

  describe('empty predictions fixture', () => {
    it('loads successfully when predictions array is empty', async () => {
      const overrides = new Map([['8447504-20260725', 'empty-predictions.json']]);
      const provider = new NoaaFixtureProvider(FIXTURES_DIR, overrides);
      const data = await provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW');
      expect(data.predictions).toHaveLength(0);
    });
  });

  describe('provider error — NOAA error envelope', () => {
    it('throws ProviderError when the response contains an error field', async () => {
      const overrides = new Map([['8447504-20260725', 'error-response.json']]);
      const provider = new NoaaFixtureProvider(FIXTURES_DIR, overrides);
      await expect(
        provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW'),
      ).rejects.toBeInstanceOf(ProviderError);
    });

    it('ProviderError message includes the NOAA error text', async () => {
      const overrides = new Map([['8447504-20260725', 'error-response.json']]);
      const provider = new NoaaFixtureProvider(FIXTURES_DIR, overrides);
      await expect(
        provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW'),
      ).rejects.toThrow('No data was found');
    });
  });

  describe('provider error — fixture not found', () => {
    it('throws ProviderError when the fixture file does not exist', async () => {
      const provider = new NoaaFixtureProvider(FIXTURES_DIR);
      await expect(
        provider.fetchHiloPredictions('0000000', '20260725', '20260726', 'MLLW'),
      ).rejects.toBeInstanceOf(ProviderError);
    });

    it('ProviderError message includes the provider name', async () => {
      const provider = new NoaaFixtureProvider(FIXTURES_DIR);
      await expect(
        provider.fetchHiloPredictions('0000000', '20260725', '20260726', 'MLLW'),
      ).rejects.toThrow('[NOAA]');
    });
  });

  describe('override map', () => {
    it('uses the override fixture file when a key is provided', async () => {
      const overrides = new Map([['8447504-20260725', 'empty-predictions.json']]);
      const provider = new NoaaFixtureProvider(FIXTURES_DIR, overrides);
      const data = await provider.fetchHiloPredictions('8447504', '20260725', '20260726', 'MLLW');
      expect(data.predictions).toHaveLength(0);
    });
  });
});
