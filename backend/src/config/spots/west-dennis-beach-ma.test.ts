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
interface WindSector {
  startDegrees: number;
  endDegrees: number;
  classification: 'DIRECT_ONSHORE' | 'SIDE_ONSHORE' | 'CROSS_SHORE' | 'SIDE_OFFSHORE' | 'OFFSHORE';
  accepted: boolean;
}

const spot = JSON.parse(fs.readFileSync(path.join(here, 'west-dennis-beach-ma.json'), 'utf8')) as {
  spotId: string;
  name: string;
  municipality?: string;
  village?: string;
  location: { latitude?: number; longitude?: number; datum?: string; timezone: string };
  launchPoint?: { latitude?: number; longitude?: number; datum?: string; description?: string };
  shore?: {
    seawardBearingDegrees: number;
    acceptedWindSectors: WindSector[];
    prohibitedWindSectors: WindSector[];
  };
  sources?: {
    noaaTideStation?: {
      stationId: string;
      name: string;
      stationType: 'H' | 'S';
      referenceStationId?: string;
      datum: string;
      lat: number;
      lng: number;
      distanceKm: number;
      availableProducts: string[];
      predictionIntervals?: string[];
      fallback: {
        stations: Array<{ stationId: string; name: string; reason: string }>;
        onAllFailed: 'NO_GO';
      };
    };
    nwsGridpoint?: {
      office: string;
      gridX: number;
      gridY: number;
      pointType: 'land' | 'marine';
      forecastZone: string;
      forecastEndpoint: string;
      forecastHourlyEndpoint: string;
      forecastGridDataEndpoint: string;
      radarStation: string;
      attribution: string;
    };
  };
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
    // Resolved by issue #3 — must no longer appear in unresolved
    expect(fields).not.toContain('sources.noaaTideStation');
    // Resolved by issue #4 — must no longer appear in unresolved
    expect(fields).not.toContain('sources.nwsGridpoint');
    // Resolved by issue #5 — must no longer appear in unresolved
    expect(fields).not.toContain('shore.seawardBearingDegrees');
    expect(fields).not.toContain('shore.acceptedWindSectors');
    expect(fields).not.toContain('shore.prohibitedWindSectors');
    expect(fields).not.toContain('location.latitude');
    expect(fields).not.toContain('location.longitude');
    expect(fields).not.toContain('municipality');
    expect(fields).not.toContain('launchPoint');
  });

  it('provides a seaward bearing in the valid SSW quadrant for a south-facing beach', () => {
    const bearing = spot.shore?.seawardBearingDegrees;
    expect(bearing).toBeDefined();
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
    // West Dennis Beach faces south into Nantucket Sound: bearing should be in the south quadrant
    expect(bearing).toBeGreaterThanOrEqual(160);
    expect(bearing).toBeLessThanOrEqual(230);
  });

  it('provides accepted sectors covering DIRECT_ONSHORE and SIDE_ONSHORE', () => {
    const sectors = spot.shore?.acceptedWindSectors ?? [];
    expect(sectors.length).toBeGreaterThan(0);
    const classifications = sectors.map((s) => s.classification);
    expect(classifications).toContain('DIRECT_ONSHORE');
    expect(classifications).toContain('SIDE_ONSHORE');
    expect(sectors.every((s) => s.accepted)).toBe(true);
  });

  it('provides prohibited sectors that cover OFFSHORE directions and are all not accepted', () => {
    const sectors = spot.shore?.prohibitedWindSectors ?? [];
    expect(sectors.length).toBeGreaterThan(0);
    const classifications = sectors.map((s) => s.classification);
    expect(classifications).toContain('OFFSHORE');
    expect(sectors.every((s) => !s.accepted)).toBe(true);
  });

  it('specifies the validated NOAA CO-OPS tide station', () => {
    const station = spot.sources?.noaaTideStation;
    expect(station).toBeDefined();
    expect(station?.stationId).toBe('8447504');
    expect(station?.name).toBe('South Yarmouth, Bass River');
    expect(station?.stationType).toBe('S');
    expect(station?.referenceStationId).toBe('8443970');
    expect(station?.datum).toBe('MLLW');
    expect(station?.distanceKm).toBeLessThanOrEqual(5);
    expect(station?.availableProducts).toContain('predictions');
    expect(station?.predictionIntervals).toContain('hilo');
  });

  it('specifies a fallback tide station and an explicit on-failure policy', () => {
    const fallback = spot.sources?.noaaTideStation?.fallback;
    expect(fallback).toBeDefined();
    expect(fallback?.stations.length).toBeGreaterThan(0);
    expect(fallback?.stations[0]?.stationId).toBe('8447525');
    expect(fallback?.onAllFailed).toBe('NO_GO');
  });

  it('specifies the validated NWS grid point and forecast endpoints', () => {
    const gp = spot.sources?.nwsGridpoint;
    expect(gp).toBeDefined();
    expect(gp?.office).toBe('BOX');
    expect(gp?.gridX).toBe(107);
    expect(gp?.gridY).toBe(74);
    expect(gp?.pointType).toBe('marine');
    expect(gp?.forecastZone).toBe('ANZ232');
    expect(gp?.forecastHourlyEndpoint).toContain('BOX/107,74');
    expect(gp?.forecastGridDataEndpoint).toContain('BOX/107,74');
    expect(gp?.radarStation).toBe('KBOX');
    expect(gp?.attribution).toContain('BOX');
  });

  it('keeps latitude and longitude within valid ranges', () => {
    expect(spot.location.latitude).toBeGreaterThanOrEqual(-90);
    expect(spot.location.latitude).toBeLessThanOrEqual(90);
    expect(spot.location.longitude).toBeGreaterThanOrEqual(-180);
    expect(spot.location.longitude).toBeLessThanOrEqual(180);
  });
});
