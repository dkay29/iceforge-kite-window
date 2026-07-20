import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

const schema = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'schemas/spot.schema.json'), 'utf8'),
) as Record<string, unknown>;
const spot = JSON.parse(fs.readFileSync(path.join(here, 'west-dennis-beach-ma.json'), 'utf8')) as {
  spotId: string;
  name: string;
  municipality?: string;
  village?: string;
  location: { latitude?: number; longitude?: number; datum?: string; timezone: string };
  launchPoint?: { latitude?: number; longitude?: number; datum?: string; description?: string };
  validationStatus: string;
  active: boolean;
  unresolved?: Array<{ field: string; reason: string; followUpIssue?: string }>;
};

describe('west-dennis-beach-ma spot configuration', () => {
  it('validates against the spot schema', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const valid = validate(spot);
    expect(validate.errors ?? []).toEqual([]);
    expect(valid).toBe(true);
  });

  it('uses the stable, URL-safe canonical spot ID', () => {
    expect(spot.spotId).toBe('west-dennis-beach-ma');
    expect(spot.spotId).toMatch(/^[a-z0-9-]+$/);
  });

  it('declares an IANA timezone independent of the local machine timezone', () => {
    expect(spot.location.timezone).toBe('America/New_York');
    expect(() =>
      Intl.DateTimeFormat(undefined, { timeZone: spot.location.timezone }),
    ).not.toThrow();
  });

  it('records the validated Massachusetts DPH monitoring coordinate', () => {
    expect(spot.municipality).toBe('Dennis');
    expect(spot.village).toBe('West Dennis');
    expect(spot.location.latitude).toBe(41.6494);
    expect(spot.location.longitude).toBe(-70.1845);
    expect(spot.location.datum).toBe('NAD83');
    expect(spot.launchPoint?.latitude).toBe(41.6494);
    expect(spot.launchPoint?.longitude).toBe(-70.1845);
    expect(spot.launchPoint?.datum).toBe('NAD83');
  });

  it('is not marked active while safety-critical fields are unresolved', () => {
    expect(spot.active).toBe(false);
    expect(spot.validationStatus).not.toBe('VALIDATED');
  });

  it('records every deferred safety-critical and provider field as unresolved', () => {
    const fields = (spot.unresolved ?? []).map((entry) => entry.field);
    for (const required of [
      'shore.seawardBearingDegrees',
      'shore.acceptedWindSectors',
      'sources.noaaTideStation',
      'sources.nwsGridpoint',
    ]) {
      expect(fields).toContain(required);
    }
    expect(fields).not.toContain('location.latitude');
    expect(fields).not.toContain('location.longitude');
    expect(fields).not.toContain('municipality');
    expect(fields).not.toContain('launchPoint');
  });

  it('keeps latitude and longitude within valid ranges', () => {
    expect(spot.location.latitude).toBeGreaterThanOrEqual(-90);
    expect(spot.location.latitude).toBeLessThanOrEqual(90);
    expect(spot.location.longitude).toBeGreaterThanOrEqual(-180);
    expect(spot.location.longitude).toBeLessThanOrEqual(180);
  });
});
