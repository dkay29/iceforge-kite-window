import { describe, expect, it } from 'vitest';
import {
  currentDailyPointerKey,
  currentLatestPointerKey,
  normalizedTimelineKey,
  publishedForecastKey,
  rawTideNoaaKey,
  rawWeatherNwsKey,
  rulesetConfigCurrentKey,
  rulesetConfigVersionKey,
  spotConfigCurrentKey,
  spotConfigVersionKey,
  userDeviceKey,
  userPreferencesKey,
} from './s3Keys.js';

const SPOT = 'west-dennis-beach-ma';
const DATE = '2026-07-26';
const RUN = '2026-07-26T06:00:00Z';
const RULESET = 'west-dennis-beach-ma-default';

describe('spotConfigCurrentKey', () => {
  it('produces the correct key', () => {
    expect(spotConfigCurrentKey(SPOT)).toBe('config/spots/west-dennis-beach-ma/current.json');
  });
  it('throws on empty spotId', () => {
    expect(() => spotConfigCurrentKey('')).toThrow('spotId');
  });
});

describe('spotConfigVersionKey', () => {
  it('produces the correct key', () => {
    expect(spotConfigVersionKey(SPOT, 5)).toBe('config/spots/west-dennis-beach-ma/versions/5.json');
  });
  it('throws on version 0', () => {
    expect(() => spotConfigVersionKey(SPOT, 0)).toThrow('version');
  });
  it('throws on negative version', () => {
    expect(() => spotConfigVersionKey(SPOT, -1)).toThrow('version');
  });
  it('throws on non-integer version', () => {
    expect(() => spotConfigVersionKey(SPOT, 1.5)).toThrow('version');
  });
});

describe('rulesetConfigCurrentKey', () => {
  it('produces the correct key', () => {
    expect(rulesetConfigCurrentKey(RULESET)).toBe(
      'config/rulesets/west-dennis-beach-ma-default/current.json',
    );
  });
  it('throws on empty rulesetId', () => {
    expect(() => rulesetConfigCurrentKey('')).toThrow('rulesetId');
  });
});

describe('rulesetConfigVersionKey', () => {
  it('produces the correct key', () => {
    expect(rulesetConfigVersionKey(RULESET, 1)).toBe(
      'config/rulesets/west-dennis-beach-ma-default/versions/1.json',
    );
  });
  it('throws on version 0', () => {
    expect(() => rulesetConfigVersionKey(RULESET, 0)).toThrow('version');
  });
});

describe('rawWeatherNwsKey', () => {
  it('produces the correct key', () => {
    expect(rawWeatherNwsKey(SPOT, DATE, RUN)).toBe(
      'raw/weather/provider=nws/spot=west-dennis-beach-ma/date=2026-07-26/run=2026-07-26T06:00:00Z.json',
    );
  });
  it('throws on empty spotId', () => {
    expect(() => rawWeatherNwsKey('', DATE, RUN)).toThrow('spotId');
  });
  it('throws on empty localDate', () => {
    expect(() => rawWeatherNwsKey(SPOT, '', RUN)).toThrow('localDate');
  });
  it('throws on empty runTimestamp', () => {
    expect(() => rawWeatherNwsKey(SPOT, DATE, '')).toThrow('runTimestamp');
  });
});

describe('rawTideNoaaKey', () => {
  it('produces the correct key', () => {
    expect(rawTideNoaaKey(SPOT, DATE, RUN)).toBe(
      'raw/tide/provider=noaa-coops/spot=west-dennis-beach-ma/date=2026-07-26/run=2026-07-26T06:00:00Z.json',
    );
  });
  it('throws on empty spotId', () => {
    expect(() => rawTideNoaaKey('', DATE, RUN)).toThrow('spotId');
  });
});

describe('normalizedTimelineKey', () => {
  it('produces the correct key', () => {
    expect(normalizedTimelineKey(SPOT, DATE, RUN)).toBe(
      'normalized/spot=west-dennis-beach-ma/date=2026-07-26/run=2026-07-26T06:00:00Z.json',
    );
  });
  it('throws on empty forecastRunId', () => {
    expect(() => normalizedTimelineKey(SPOT, DATE, '')).toThrow('forecastRunId');
  });
});

describe('publishedForecastKey', () => {
  it('produces the correct key', () => {
    expect(publishedForecastKey(SPOT, DATE, RULESET, RUN)).toBe(
      'published/spot=west-dennis-beach-ma/date=2026-07-26/ruleset=west-dennis-beach-ma-default/run=2026-07-26T06:00:00Z.json',
    );
  });
  it('throws on empty rulesetId', () => {
    expect(() => publishedForecastKey(SPOT, DATE, '', RUN)).toThrow('rulesetId');
  });
  it('throws on empty forecastRunId', () => {
    expect(() => publishedForecastKey(SPOT, DATE, RULESET, '')).toThrow('forecastRunId');
  });
});

describe('currentDailyPointerKey', () => {
  it('produces the correct key', () => {
    expect(currentDailyPointerKey(SPOT, DATE)).toBe(
      'current/spot=west-dennis-beach-ma/date=2026-07-26/default.json',
    );
  });
  it('throws on empty localDate', () => {
    expect(() => currentDailyPointerKey(SPOT, '')).toThrow('localDate');
  });
});

describe('currentLatestPointerKey', () => {
  it('produces the correct key', () => {
    expect(currentLatestPointerKey(SPOT)).toBe('current/spot=west-dennis-beach-ma/latest.json');
  });
  it('throws on empty spotId', () => {
    expect(() => currentLatestPointerKey('')).toThrow('spotId');
  });
});

describe('userPreferencesKey', () => {
  it('produces the correct key', () => {
    expect(userPreferencesKey('abc-123')).toBe('users/abc-123/preferences.json');
  });
  it('throws on empty cognitoSub', () => {
    expect(() => userPreferencesKey('')).toThrow('cognitoSub');
  });
});

describe('userDeviceKey', () => {
  it('produces the correct key', () => {
    expect(userDeviceKey('abc-123', 'device-xyz')).toBe('users/abc-123/devices/device-xyz.json');
  });
  it('throws on empty deviceId', () => {
    expect(() => userDeviceKey('abc-123', '')).toThrow('deviceId');
  });
  it('throws on empty cognitoSub', () => {
    expect(() => userDeviceKey('', 'device-xyz')).toThrow('cognitoSub');
  });
});

describe('illegal character rejection', () => {
  it('rejects # in spotId', () => {
    expect(() => spotConfigCurrentKey('spot#bad')).toThrow('illegal character');
  });
  it('rejects ? in spotId', () => {
    expect(() => spotConfigCurrentKey('spot?bad')).toThrow('illegal character');
  });
});
