/**
 * Solar event calculations: sunrise, sunset, and civil twilight.
 *
 * Uses the NOAA Solar Calculator algorithm (Jean Meeus, "Astronomical
 * Algorithms", 2nd ed.). Accurate to ±1–2 minutes at mid-latitudes.
 *
 * All inputs use geographic coordinates (positive north, positive east).
 * All outputs are UTC milliseconds since the Unix epoch.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// Zenith angles (degrees below horizontal)
const ZENITH_SUNRISE = 90.833; // accounts for atmospheric refraction and solar disc
const ZENITH_CIVIL = 96.0; // civil twilight

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SolarEvents {
  /** UTC ms at which the sun rises. Null during polar night or midnight sun. */
  sunriseUtcMs: number | null;
  /** UTC ms at which the sun sets. Null during polar night or midnight sun. */
  sunsetUtcMs: number | null;
  /** UTC ms at which civil twilight begins (morning). Null during polar night or midnight sun. */
  civilTwilightBeginUtcMs: number | null;
  /** UTC ms at which civil twilight ends (evening). Null during polar night or midnight sun. */
  civilTwilightEndUtcMs: number | null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculate solar events for a given date and location.
 *
 * @param year         - Full calendar year (e.g. 2026).
 * @param month        - 1-based month (1 = January).
 * @param day          - Day of month (1-based).
 * @param latitudeDeg  - Geographic latitude in decimal degrees (+N, −S).
 * @param longitudeDeg - Geographic longitude in decimal degrees (+E, −W).
 */
export function calculateSolarEvents(
  year: number,
  month: number,
  day: number,
  latitudeDeg: number,
  longitudeDeg: number,
): SolarEvents {
  const midnightUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  // Use Julian century at solar noon (approximated at 12:00 UTC)
  const noonUtcMs = midnightUtcMs + 12 * 60 * 60 * 1000;
  const jd = toJulianDay(noonUtcMs);
  const T = julianCentury(jd);

  const eqT = equationOfTimeMinutes(T);
  const decl = sunDeclinationDeg(T);

  const solarNoonMinutes = 720 - 4 * longitudeDeg - eqT;

  const sunriseHa = hourAngleDeg(latitudeDeg, decl, ZENITH_SUNRISE);
  const civilHa = hourAngleDeg(latitudeDeg, decl, ZENITH_CIVIL);

  return {
    sunriseUtcMs: computeTime(sunriseHa, solarNoonMinutes, midnightUtcMs, 'rise'),
    sunsetUtcMs: computeTime(sunriseHa, solarNoonMinutes, midnightUtcMs, 'set'),
    civilTwilightBeginUtcMs: computeTime(civilHa, solarNoonMinutes, midnightUtcMs, 'rise'),
    civilTwilightEndUtcMs: computeTime(civilHa, solarNoonMinutes, midnightUtcMs, 'set'),
  };
}

/**
 * Return true when a given UTC instant falls within civil daylight
 * (between civil twilight begin and civil twilight end).
 *
 * When civil twilight bounds are null (polar regions), returns false.
 */
export function isDaytime(timeUtcMs: number, solar: SolarEvents): boolean {
  if (solar.civilTwilightBeginUtcMs === null || solar.civilTwilightEndUtcMs === null) {
    return false;
  }
  return timeUtcMs >= solar.civilTwilightBeginUtcMs && timeUtcMs < solar.civilTwilightEndUtcMs;
}

// ─── NOAA algorithm helpers ───────────────────────────────────────────────────

function toJulianDay(utcMs: number): number {
  return utcMs / 86400000 + 2440587.5;
}

function julianCentury(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

function geomMeanLongSunDeg(T: number): number {
  return (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
}

function geomMeanAnomalySunDeg(T: number): number {
  return 357.52911 + T * (35999.05029 - T * 0.0001537);
}

function eccentricityEarthOrbit(T: number): number {
  return 0.016708634 - T * (0.000042037 + T * 0.0000001267);
}

function equationOfCenterDeg(T: number): number {
  const M = geomMeanAnomalySunDeg(T) * DEG;
  return (
    Math.sin(M) * (1.9146 - T * (0.004817 + T * 0.000014)) +
    Math.sin(2 * M) * (0.019993 - T * 0.000101) +
    Math.sin(3 * M) * 0.00029
  );
}

function sunApparentLongitudeDeg(T: number): number {
  const L0 = geomMeanLongSunDeg(T);
  const C = equationOfCenterDeg(T);
  const Θ = L0 + C;
  return Θ - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * DEG);
}

function meanObliquityEclipticDeg(T: number): number {
  return 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
}

function obliqCorrectedDeg(T: number): number {
  return meanObliquityEclipticDeg(T) + 0.00256 * Math.cos((125.04 - 1934.136 * T) * DEG);
}

function sunDeclinationDeg(T: number): number {
  const ε = obliqCorrectedDeg(T) * DEG;
  const λ = sunApparentLongitudeDeg(T) * DEG;
  return Math.asin(Math.sin(ε) * Math.sin(λ)) * RAD;
}

function equationOfTimeMinutes(T: number): number {
  const ε = obliqCorrectedDeg(T) * DEG;
  const L0 = geomMeanLongSunDeg(T) * DEG;
  const e = eccentricityEarthOrbit(T);
  const M = geomMeanAnomalySunDeg(T) * DEG;
  const y = Math.tan(ε / 2) ** 2;
  return (
    4 *
    RAD *
    (y * Math.sin(2 * L0) -
      2 * e * Math.sin(M) +
      4 * e * y * Math.sin(M) * Math.cos(2 * L0) -
      0.5 * y * y * Math.sin(4 * L0) -
      1.25 * e * e * Math.sin(2 * M))
  );
}

/**
 * Hour angle for a given zenith (degrees).
 * Returns null on polar-night (sun never rises) or midnight-sun (sun never sets).
 */
function hourAngleDeg(latDeg: number, declDeg: number, zenithDeg: number): number | null {
  const lat = latDeg * DEG;
  const decl = declDeg * DEG;
  const zenith = zenithDeg * DEG;
  const cosH = Math.cos(zenith) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
  if (cosH > 1) return null; // polar night — sun never reaches the zenith (never rises)
  if (cosH < -1) return null; // midnight sun — sun never descends below the zenith (never sets)
  return Math.acos(cosH) * RAD;
}

function computeTime(
  ha: number | null,
  solarNoonMinutes: number,
  midnightUtcMs: number,
  which: 'rise' | 'set',
): number | null {
  if (ha === null) return null;
  const offsetMinutes = which === 'rise' ? -ha * 4 : ha * 4;
  const utcMinutes = solarNoonMinutes + offsetMinutes;
  return midnightUtcMs + Math.round(utcMinutes * 60000);
}
