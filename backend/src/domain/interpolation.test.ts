import { describe, expect, it } from 'vitest';
import {
  circularInterpolate,
  conservativeHazardInterpolate,
  interpolateScalar,
  isStale,
  linearInterpolate,
  MAX_INTERPOLATION_GAP_MS,
  STALENESS_THRESHOLD_MS,
} from './interpolation.js';

describe('linearInterpolate', () => {
  it('returns a at t=0', () => expect(linearInterpolate(10, 20, 0)).toBe(10));
  it('returns b at t=1', () => expect(linearInterpolate(10, 20, 1)).toBe(20));
  it('returns midpoint at t=0.5', () => expect(linearInterpolate(10, 20, 0.5)).toBe(15));
  it('works with descending values', () => expect(linearInterpolate(20, 10, 0.5)).toBe(15));
  it('works with negative values', () => expect(linearInterpolate(-10, 10, 0.5)).toBe(0));
});

describe('circularInterpolate', () => {
  it('returns a at t=0', () => expect(circularInterpolate(10, 90, 0)).toBeCloseTo(10));
  it('returns b at t=1', () => expect(circularInterpolate(10, 90, 1)).toBeCloseTo(90));
  it('returns midpoint for non-wrapping case', () =>
    expect(circularInterpolate(10, 90, 0.5)).toBeCloseTo(50));

  it('takes the shortest arc wrapping through 0°/360°', () => {
    // From 350° to 10°: shortest arc is +20° (clockwise through 0°)
    // At t=0.5: 350° + 20° * 0.5 = 360° = 0°
    expect(circularInterpolate(350, 10, 0.5)).toBeCloseTo(0);
  });

  it('wraps correctly from 10° to 350° (shortest arc is -20°, counter-clockwise)', () => {
    // From 10° to 350°: delta = 350-10=340 → >180 → delta=-20
    // At t=0.5: 10° + (-20°)*0.5 = 0°
    expect(circularInterpolate(10, 350, 0.5)).toBeCloseTo(0);
  });

  it('handles 0°/360° boundary inputs', () => {
    expect(circularInterpolate(0, 0, 0.5)).toBeCloseTo(0);
    expect(circularInterpolate(0, 360, 0.5)).toBeCloseTo(0); // same direction
  });

  it('handles interpolation through north (S→N half-way → E or W)', () => {
    // From 180° to 0° (or 360°): delta=180° → ambiguous; clockwise convention
    const result = circularInterpolate(180, 0, 0.5);
    // delta = (0-180+360)%360 = 180; 180 > 180 is false so no flip; stays clockwise
    expect(result).toBeCloseTo(270); // 180 + 180*0.5 = 270° (clockwise: SW→W→NW)
  });

  it('result is always in [0, 360)', () => {
    for (let a = 0; a < 360; a += 45) {
      for (let b = 0; b < 360; b += 45) {
        const r = circularInterpolate(a, b, 0.5);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(360);
      }
    }
  });
});

describe('conservativeHazardInterpolate', () => {
  it('returns the higher of two values', () => {
    expect(conservativeHazardInterpolate(20, 80)).toBe(80);
    expect(conservativeHazardInterpolate(80, 20)).toBe(80);
  });

  it('returns the value when both are equal', () => {
    expect(conservativeHazardInterpolate(50, 50)).toBe(50);
  });

  it('handles zero', () => {
    expect(conservativeHazardInterpolate(0, 40)).toBe(40);
    expect(conservativeHazardInterpolate(0, 0)).toBe(0);
  });
});

describe('interpolateScalar', () => {
  const maxGap = 3 * 60 * 60 * 1000; // 3 hours
  const h = (n: number) => n * 60 * 60 * 1000;

  it('interpolates between two points within the gap limit', () => {
    const points = [
      { timeMs: h(0), value: 10 },
      { timeMs: h(2), value: 20 },
    ];
    const slots = [h(0), h(1), h(2)];
    const result = interpolateScalar(points, slots, maxGap);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(15);
    expect(result[2]).toBeCloseTo(20);
  });

  it('returns null for a gap exceeding maxGapMs', () => {
    const points = [
      { timeMs: h(0), value: 10 },
      { timeMs: h(4), value: 20 }, // 4h gap > 3h limit
    ];
    const slots = [h(0), h(2), h(4)];
    const result = interpolateScalar(points, slots, maxGap);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeNull(); // gap too large
    expect(result[2]).toBeCloseTo(20);
  });

  it('returns null for slots before all data', () => {
    const points = [{ timeMs: h(5), value: 15 }];
    const slots = [h(3), h(5)];
    const result = interpolateScalar(points, slots, maxGap);
    expect(result[0]).toBeNull();
    expect(result[1]).toBe(15);
  });

  it('returns null for slots after all data', () => {
    const points = [{ timeMs: h(0), value: 10 }];
    const slots = [h(0), h(2)];
    const result = interpolateScalar(points, slots, maxGap);
    expect(result[0]).toBe(10);
    expect(result[1]).toBeNull();
  });

  it('returns null for all slots when no data exists', () => {
    const result = interpolateScalar([], [h(0), h(1)], maxGap);
    expect(result).toEqual([null, null]);
  });

  it('uses the provided custom interpolation function', () => {
    const points = [
      { timeMs: h(0), value: 10 },
      { timeMs: h(2), value: 30 },
    ];
    const slots = [h(1)];
    const result = interpolateScalar(points, slots, maxGap, (a, b) =>
      conservativeHazardInterpolate(a, b),
    );
    expect(result[0]).toBe(30); // conservative: max(10, 30)
  });
});

describe('isStale', () => {
  const hour = 60 * 60 * 1000;

  it('returns false when data is fresh', () => {
    expect(isStale(1000 * hour, 1001 * hour, 2 * hour)).toBe(false);
  });

  it('returns true when data exceeds the max age', () => {
    expect(isStale(1000 * hour, 1003 * hour, 2 * hour)).toBe(true);
  });

  it('returns false when age exactly equals maxAgeMs', () => {
    // age = maxAge exactly → not stale (strict >)
    expect(isStale(1000 * hour, 1002 * hour, 2 * hour)).toBe(false);
  });

  it('returns true when age exceeds maxAgeMs by 1 ms', () => {
    expect(isStale(1000 * hour, 1000 * hour + 2 * hour + 1, 2 * hour)).toBe(true);
  });
});

describe('MAX_INTERPOLATION_GAP_MS', () => {
  it('wind fields have a 3-hour max gap', () => {
    expect(MAX_INTERPOLATION_GAP_MS['windSpeedKnots']).toBe(3 * 60 * 60 * 1000);
    expect(MAX_INTERPOLATION_GAP_MS['windDirectionDegrees']).toBe(3 * 60 * 60 * 1000);
    expect(MAX_INTERPOLATION_GAP_MS['gustSpeedKnots']).toBe(3 * 60 * 60 * 1000);
  });

  it('tide and weather fields have a 6-hour max gap', () => {
    expect(MAX_INTERPOLATION_GAP_MS['tideHeightFeet']).toBe(6 * 60 * 60 * 1000);
    expect(MAX_INTERPOLATION_GAP_MS['probabilityOfThunder']).toBe(6 * 60 * 60 * 1000);
  });
});

describe('STALENESS_THRESHOLD_MS', () => {
  it('NWS forecast threshold is 2 hours', () => {
    expect(STALENESS_THRESHOLD_MS['nwsForecast']).toBe(2 * 60 * 60 * 1000);
  });

  it('NOAA tide predictions threshold is 24 hours', () => {
    expect(STALENESS_THRESHOLD_MS['noaaTidePredictions']).toBe(24 * 60 * 60 * 1000);
  });
});
