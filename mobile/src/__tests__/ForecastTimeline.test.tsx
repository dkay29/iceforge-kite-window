/**
 * Tests for ForecastTimeline component and ForecastService.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { ForecastTimeline, type ForecastTimelineProps } from '../components/ForecastTimeline';
import {
  ForecastService,
  ForecastNotAvailableError,
  type ForecastHttpClient,
  type TimelinePoint,
  type RecommendationStatus,
} from '../services/forecastService';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePoint(
  timeUtc: string,
  status: RecommendationStatus = 'GO',
  overrides: Partial<TimelinePoint> = {},
): TimelinePoint {
  return {
    timeUtc,
    status,
    score: status === 'UNKNOWN' ? null : 80,
    windSpeedKnots: 18,
    gustKnots: 22,
    tideHeightFeet: 2.5,
    isDaylight: true,
    ...overrides,
  };
}

const DAYLIGHT = {
  sunriseUtc: '2026-07-26T09:00:00Z',
  sunsetUtc: '2026-07-26T23:00:00Z',
  civilTwilightBeginUtc: '2026-07-26T08:30:00Z',
  civilTwilightEndUtc: '2026-07-26T23:30:00Z',
};

const TIDE_EVENTS = [
  { timeUtc: '2026-07-26T12:00:00Z', type: 'LOW' as const, heightFeet: 0.5 },
  { timeUtc: '2026-07-26T18:00:00Z', type: 'HIGH' as const, heightFeet: 5.0 },
];

const BEST_WINDOW = {
  startUtc: '2026-07-26T11:00:00Z',
  endUtc: '2026-07-26T14:00:00Z',
  status: 'GO' as const,
  score: 82,
  lowTideUtc: '2026-07-26T12:00:00Z',
  reasons: ['Wind onshore', 'Low tide centred'],
};

// Build a 96-point timeline (one full day)
function makePoints(): TimelinePoint[] {
  const pts: TimelinePoint[] = [];
  const base = new Date('2026-07-26T00:00:00Z').getTime();
  for (let i = 0; i < 96; i++) {
    const ms = base + i * 15 * 60 * 1000;
    pts.push(makePoint(new Date(ms).toISOString(), i > 40 && i < 60 ? 'GO' : 'NO_GO'));
  }
  return pts;
}

function makeProps(overrides: Partial<ForecastTimelineProps> = {}): ForecastTimelineProps {
  return {
    points: makePoints(),
    tideEvents: TIDE_EVENTS,
    daylight: DAYLIGHT,
    bestWindow: BEST_WINDOW,
    timezone: 'America/New_York',
    ...overrides,
  };
}

// ─── ForecastTimeline component tests ─────────────────────────────────────────

describe('ForecastTimeline', () => {
  it('renders without crashing with valid props', () => {
    expect(() => render(<ForecastTimeline {...makeProps()} />)).not.toThrow();
  });

  it('renders with null bestWindow', () => {
    expect(() => render(<ForecastTimeline {...makeProps({ bestWindow: null })} />)).not.toThrow();
  });

  it('renders with empty tideEvents', () => {
    expect(() => render(<ForecastTimeline {...makeProps({ tideEvents: [] })} />)).not.toThrow();
  });

  it('renders with a single point', () => {
    const single = [makePoint('2026-07-26T12:00:00Z', 'MARGINAL')];
    expect(() => render(<ForecastTimeline {...makeProps({ points: single })} />)).not.toThrow();
  });

  it('renders with UNKNOWN status points (null score)', () => {
    const pts = [makePoint('2026-07-26T06:00:00Z', 'UNKNOWN', { score: null })];
    expect(() => render(<ForecastTimeline {...makeProps({ points: pts })} />)).not.toThrow();
  });

  it('renders with missing wind data', () => {
    const pts = [
      makePoint('2026-07-26T06:00:00Z', 'GO', {
        windSpeedKnots: null,
        gustKnots: null,
        tideHeightFeet: null,
      }),
    ];
    expect(() => render(<ForecastTimeline {...makeProps({ points: pts })} />)).not.toThrow();
  });
});

// ─── ForecastService tests ─────────────────────────────────────────────────────

const MOCK_FORECAST = {
  schemaVersion: '1.0',
  spot: { spotId: 'west-dennis-beach-ma', name: 'West Dennis Beach', timezone: 'America/New_York' },
  localDate: '2026-07-26',
  generatedAt: '2026-07-26T18:00:00Z',
  expiresAt: '2026-07-26T22:00:00Z',
  daylight: DAYLIGHT,
  tideEvents: TIDE_EVENTS,
  assessment: { status: 'GO', bestWindow: BEST_WINDOW, alternatives: [] },
  timeline: { timelinePoints: makePoints() },
  revision: '2026-07-26T18:00:00.000Z',
};

function makeHttp(overrides: Partial<ForecastHttpClient> = {}): ForecastHttpClient {
  return {
    get: jest.fn().mockResolvedValue({
      status: 200,
      body: MOCK_FORECAST,
      headers: { etag: '"abc123"' },
    }),
    ...overrides,
  };
}

describe('ForecastService', () => {
  it('returns forecast and stripped ETag on 200', async () => {
    const service = new ForecastService(makeHttp());
    const result = await service.get('west-dennis-beach-ma', '2026-07-26');
    expect(result).not.toBeNull();
    expect(result!.forecast.localDate).toBe('2026-07-26');
    expect(result!.etag).toBe('abc123');
  });

  it('sends If-None-Match when cachedEtag is provided', async () => {
    const http = makeHttp();
    const service = new ForecastService(http);
    await service.get('west-dennis-beach-ma', '2026-07-26', 'abc123');
    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('west-dennis-beach-ma'),
      expect.objectContaining({ 'If-None-Match': 'abc123' }),
    );
  });

  it('returns null on 304', async () => {
    const http = makeHttp({
      get: jest.fn().mockResolvedValue({ status: 304, body: {}, headers: {} }),
    });
    const service = new ForecastService(http);
    expect(await service.get('west-dennis-beach-ma', '2026-07-26', 'cached')).toBeNull();
  });

  it('throws ForecastNotAvailableError on 404', async () => {
    const http = makeHttp({
      get: jest.fn().mockResolvedValue({ status: 404, body: {}, headers: {} }),
    });
    const service = new ForecastService(http);
    await expect(service.get('west-dennis-beach-ma', '2026-07-26')).rejects.toBeInstanceOf(
      ForecastNotAvailableError,
    );
  });

  it('throws on unexpected status', async () => {
    const http = makeHttp({
      get: jest.fn().mockResolvedValue({ status: 500, body: {}, headers: {} }),
    });
    const service = new ForecastService(http);
    await expect(service.get('west-dennis-beach-ma', '2026-07-26')).rejects.toThrow('500');
  });

  it('includes spotId and date in the request path', async () => {
    const http = makeHttp();
    const service = new ForecastService(http);
    await service.get('west-dennis-beach-ma', '2026-07-26');
    expect(http.get).toHaveBeenCalledWith(
      expect.stringContaining('date=2026-07-26'),
      expect.any(Object),
    );
  });
});
