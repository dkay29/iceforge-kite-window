import { describe, expect, it } from 'vitest';
import {
  circularAbsDiff,
  classifyWind,
  classifyWindDirection,
  isAcceptedClassification,
  normalizeDegrees,
} from './windDirection.js';

// West Dennis Beach seaward bearing used throughout
const BEARING = 195;

describe('normalizeDegrees', () => {
  it('leaves values already in [0, 360) unchanged', () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(359)).toBe(359);
  });

  it('normalizes 360 to 0', () => {
    expect(normalizeDegrees(360)).toBe(0);
  });

  it('normalizes values greater than 360', () => {
    expect(normalizeDegrees(361)).toBe(1);
    expect(normalizeDegrees(720)).toBe(0);
    expect(normalizeDegrees(540)).toBe(180);
  });

  it('normalizes negative values', () => {
    expect(normalizeDegrees(-1)).toBe(359);
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(-360)).toBe(0);
  });
});

describe('circularAbsDiff', () => {
  it('returns 0 for identical angles', () => {
    expect(circularAbsDiff(0, 0)).toBe(0);
    expect(circularAbsDiff(195, 195)).toBe(0);
  });

  it('returns 180 for opposite angles', () => {
    expect(circularAbsDiff(0, 180)).toBe(180);
    expect(circularAbsDiff(195, 15)).toBe(180);
  });

  it('wraps correctly around 0°/360° boundary', () => {
    // 350° and 10° are 20° apart (not 340°)
    expect(circularAbsDiff(350, 10)).toBe(20);
    expect(circularAbsDiff(10, 350)).toBe(20);
  });

  it('returns the shorter arc for all quadrants', () => {
    expect(circularAbsDiff(90, 0)).toBe(90);
    expect(circularAbsDiff(270, 0)).toBe(90);
    expect(circularAbsDiff(180, 0)).toBe(180);
  });

  it('is symmetric', () => {
    expect(circularAbsDiff(30, 200)).toBe(circularAbsDiff(200, 30));
    expect(circularAbsDiff(355, 5)).toBe(circularAbsDiff(5, 355));
  });
});

describe('classifyWindDirection — West Dennis Beach seaward bearing 195°', () => {
  // --- DIRECT_ONSHORE: φ ≤ 30° ---
  it('classifies exact seaward direction as DIRECT_ONSHORE', () => {
    expect(classifyWindDirection(195, BEARING)).toBe('DIRECT_ONSHORE');
  });

  it('classifies wind at seawardBearing+30° boundary as DIRECT_ONSHORE (inclusive)', () => {
    expect(classifyWindDirection(225, BEARING)).toBe('DIRECT_ONSHORE'); // φ = 30°
  });

  it('classifies wind at seawardBearing−30° boundary as DIRECT_ONSHORE (inclusive)', () => {
    expect(classifyWindDirection(165, BEARING)).toBe('DIRECT_ONSHORE'); // φ = 30°
  });

  it('classifies SSW wind (200°) as DIRECT_ONSHORE — example 1 from shore-bearing.md', () => {
    expect(classifyWindDirection(200, BEARING)).toBe('DIRECT_ONSHORE');
  });

  // --- SIDE_ONSHORE: 30° < φ ≤ 75° ---
  it('classifies wind at seawardBearing+31° as SIDE_ONSHORE (just past boundary)', () => {
    expect(classifyWindDirection(226, BEARING)).toBe('SIDE_ONSHORE'); // φ = 31°
  });

  it('classifies wind at seawardBearing+75° boundary as SIDE_ONSHORE (inclusive)', () => {
    expect(classifyWindDirection(270, BEARING)).toBe('SIDE_ONSHORE'); // φ = 75°
  });

  it('classifies SE wind (150°) as SIDE_ONSHORE — example 2 from shore-bearing.md', () => {
    expect(classifyWindDirection(150, BEARING)).toBe('SIDE_ONSHORE'); // φ = 45°
  });

  it('classifies SW wind (240°) as SIDE_ONSHORE — example 3 from shore-bearing.md', () => {
    expect(classifyWindDirection(240, BEARING)).toBe('SIDE_ONSHORE'); // φ = 45°
  });

  // --- CROSS_SHORE: 75° < φ ≤ 90° ---
  it('classifies wind at seawardBearing+76° as CROSS_SHORE (just past side-onshore boundary)', () => {
    expect(classifyWindDirection(271, BEARING)).toBe('CROSS_SHORE'); // φ = 76°
  });

  it('classifies wind at seawardBearing+90° boundary as CROSS_SHORE (inclusive)', () => {
    expect(classifyWindDirection(285, BEARING)).toBe('CROSS_SHORE'); // φ = 90°
  });

  it('classifies ESE wind (112°) as CROSS_SHORE — example 4 from shore-bearing.md', () => {
    expect(classifyWindDirection(112, BEARING)).toBe('CROSS_SHORE'); // φ = 83°
  });

  // --- SIDE_OFFSHORE: 90° < φ ≤ 135° ---
  it('classifies wind at seawardBearing+91° as SIDE_OFFSHORE (just past cross-shore boundary)', () => {
    expect(classifyWindDirection(286, BEARING)).toBe('SIDE_OFFSHORE'); // φ = 91°
  });

  it('classifies wind at seawardBearing+135° boundary as SIDE_OFFSHORE (inclusive)', () => {
    expect(classifyWindDirection(330, BEARING)).toBe('SIDE_OFFSHORE'); // φ = 135°
  });

  it('classifies NW wind (320°) as SIDE_OFFSHORE — example 7 from shore-bearing.md', () => {
    expect(classifyWindDirection(320, BEARING)).toBe('SIDE_OFFSHORE'); // φ = 125°
  });

  // --- OFFSHORE: φ > 135° ---
  it('classifies wind at seawardBearing+136° as OFFSHORE (just past side-offshore boundary)', () => {
    expect(classifyWindDirection(331, BEARING)).toBe('OFFSHORE'); // φ = 136°
  });

  it('classifies N wind (0°) as OFFSHORE — example 6 from shore-bearing.md', () => {
    expect(classifyWindDirection(0, BEARING)).toBe('OFFSHORE'); // φ = 165°
  });

  it('classifies NE wind (45°) as OFFSHORE — example 5 from shore-bearing.md', () => {
    expect(classifyWindDirection(45, BEARING)).toBe('OFFSHORE'); // φ = 150°
  });

  it('classifies NNW wind (340°) as OFFSHORE — example 7b from shore-bearing.md', () => {
    expect(classifyWindDirection(340, BEARING)).toBe('OFFSHORE'); // φ = 145°
  });

  it('classifies exact landward direction (15°) as OFFSHORE (φ = 180°)', () => {
    expect(classifyWindDirection(15, BEARING)).toBe('OFFSHORE'); // φ = 180°
  });
});

describe('classifyWindDirection — 0°/360° wrapping edge cases', () => {
  it('treats 0° and 360° as the same direction', () => {
    expect(classifyWindDirection(0, 0)).toBe('DIRECT_ONSHORE');
    expect(classifyWindDirection(360, 0)).toBe('DIRECT_ONSHORE');
  });

  it('wraps correctly when seaward bearing is near 0°', () => {
    // Bearing = 10°, wind from 350° → diff = 20° → DIRECT_ONSHORE
    expect(classifyWindDirection(350, 10)).toBe('DIRECT_ONSHORE');
    // Bearing = 10°, wind from 0° → diff = 10° → DIRECT_ONSHORE
    expect(classifyWindDirection(0, 10)).toBe('DIRECT_ONSHORE');
  });

  it('wraps correctly when seaward bearing is near 360°', () => {
    // Bearing = 355°, wind from 10° → diff = 15° → DIRECT_ONSHORE
    expect(classifyWindDirection(10, 355)).toBe('DIRECT_ONSHORE');
    // Bearing = 355°, wind from 180° → diff = 175° → OFFSHORE
    expect(classifyWindDirection(180, 355)).toBe('OFFSHORE');
  });

  it('359° and 1° are 2° apart', () => {
    expect(circularAbsDiff(359, 1)).toBe(2);
    expect(circularAbsDiff(1, 359)).toBe(2);
  });
});

describe('classifyWindDirection — exact classification boundaries', () => {
  it('30° boundary: DIRECT_ONSHORE (inclusive)', () => {
    expect(classifyWindDirection(BEARING + 30, BEARING)).toBe('DIRECT_ONSHORE');
    expect(classifyWindDirection(BEARING - 30, BEARING)).toBe('DIRECT_ONSHORE');
  });

  it('31° boundary: SIDE_ONSHORE', () => {
    expect(classifyWindDirection(BEARING + 31, BEARING)).toBe('SIDE_ONSHORE');
    expect(classifyWindDirection(BEARING - 31, BEARING)).toBe('SIDE_ONSHORE');
  });

  it('75° boundary: SIDE_ONSHORE (inclusive)', () => {
    expect(classifyWindDirection(BEARING + 75, BEARING)).toBe('SIDE_ONSHORE');
    expect(classifyWindDirection(BEARING - 75, BEARING)).toBe('SIDE_ONSHORE');
  });

  it('76° boundary: CROSS_SHORE', () => {
    expect(classifyWindDirection(BEARING + 76, BEARING)).toBe('CROSS_SHORE');
    expect(classifyWindDirection(BEARING - 76, BEARING)).toBe('CROSS_SHORE');
  });

  it('90° boundary: CROSS_SHORE (inclusive)', () => {
    expect(classifyWindDirection(BEARING + 90, BEARING)).toBe('CROSS_SHORE');
    expect(classifyWindDirection(BEARING - 90, BEARING)).toBe('CROSS_SHORE');
  });

  it('91° boundary: SIDE_OFFSHORE', () => {
    expect(classifyWindDirection(BEARING + 91, BEARING)).toBe('SIDE_OFFSHORE');
    expect(classifyWindDirection(BEARING - 91, BEARING)).toBe('SIDE_OFFSHORE');
  });

  it('135° boundary: SIDE_OFFSHORE (inclusive)', () => {
    expect(classifyWindDirection(BEARING + 135, BEARING)).toBe('SIDE_OFFSHORE');
    expect(classifyWindDirection(BEARING - 135, BEARING)).toBe('SIDE_OFFSHORE');
  });

  it('136° boundary: OFFSHORE', () => {
    expect(classifyWindDirection(BEARING + 136, BEARING)).toBe('OFFSHORE');
    expect(classifyWindDirection(BEARING - 136, BEARING)).toBe('OFFSHORE');
  });
});

describe('isAcceptedClassification', () => {
  it('accepts DIRECT_ONSHORE', () => {
    expect(isAcceptedClassification('DIRECT_ONSHORE')).toBe(true);
  });

  it('accepts SIDE_ONSHORE', () => {
    expect(isAcceptedClassification('SIDE_ONSHORE')).toBe(true);
  });

  it('rejects CROSS_SHORE', () => {
    expect(isAcceptedClassification('CROSS_SHORE')).toBe(false);
  });

  it('rejects SIDE_OFFSHORE', () => {
    expect(isAcceptedClassification('SIDE_OFFSHORE')).toBe(false);
  });

  it('rejects OFFSHORE', () => {
    expect(isAcceptedClassification('OFFSHORE')).toBe(false);
  });
});

describe('classifyWind — convenience wrapper', () => {
  it('returns classification and accepted together for onshore wind', () => {
    const result = classifyWind(200, BEARING);
    expect(result.classification).toBe('DIRECT_ONSHORE');
    expect(result.accepted).toBe(true);
  });

  it('returns classification and accepted together for offshore wind', () => {
    const result = classifyWind(0, BEARING);
    expect(result.classification).toBe('OFFSHORE');
    expect(result.accepted).toBe(false);
  });
});
