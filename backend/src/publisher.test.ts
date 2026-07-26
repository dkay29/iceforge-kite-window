import { describe, expect, it, vi } from 'vitest';
import type { PublishedSpotForecast } from './generated/schema-types.js';
import { ConditionalWriteError, VerificationError, publishForecast } from './publisher.js';
import type { S3Client } from './publisher.js';

// ─── Minimal valid forecast fixture ──────────────────────────────────────────

const SPOT = 'west-dennis-beach-ma';
const DATE = '2026-07-26';
const RULESET = 'west-dennis-beach-ma-default';
const RUN = '2026-07-26T06:00:00Z';

const FORECAST: PublishedSpotForecast = {
  schemaVersion: '1.0',
  spot: { spotId: SPOT, name: 'West Dennis Beach', timezone: 'America/New_York' },
  localDate: DATE,
  generatedAt: RUN,
  expiresAt: '2026-07-26T08:00:00Z',
  daylight: {
    sunriseUtc: '2026-07-26T09:28:00Z',
    sunsetUtc: '2026-07-27T00:06:00Z',
    civilTwilightBeginUtc: '2026-07-26T08:57:00Z',
    civilTwilightEndUtc: '2026-07-27T00:37:00Z',
  },
  tideEvents: [
    {
      timeUtc: '2026-07-26T08:47:00Z',
      type: 'LOW',
      heightFeet: 0.4,
      station: '8447504',
      datum: 'MLLW',
    },
  ],
  assessment: {
    status: 'GO',
    bestWindow: null,
    alternatives: [],
    timelinePoints: [
      {
        timeUtc: '2026-07-26T07:15:00Z',
        status: 'GO',
        score: 82,
        isDaylight: true,
        isInBestWindow: false,
      },
    ],
  },
  revision: RUN,
};

const INPUT = {
  spotId: SPOT,
  localDate: DATE,
  rulesetId: RULESET,
  forecastRunId: RUN,
  forecast: FORECAST,
};

// ─── Mock factory ─────────────────────────────────────────────────────────────

function makeMockS3(overrides?: Partial<S3Client>): {
  s3: S3Client;
  puts: Array<[string, unknown]>;
} {
  const store = new Map<string, unknown>();
  const puts: Array<[string, unknown]> = [];

  const s3: S3Client = {
    putJson: vi.fn(async (key: string, value: unknown, options?: { ifNoneMatch?: boolean }) => {
      if (options?.ifNoneMatch && store.has(key)) {
        throw new ConditionalWriteError(key);
      }
      store.set(key, value);
      puts.push([key, value]);
    }),
    getJson: vi.fn(async (key: string) => store.get(key) ?? null),
    ...overrides,
  };

  return { s3, puts };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('publishForecast', () => {
  it('writes the published forecast to the immutable key', async () => {
    const { s3, puts } = makeMockS3();
    await publishForecast(s3, INPUT);
    const immutableKey = `published/spot=${SPOT}/date=${DATE}/ruleset=${RULESET}/run=${RUN}.json`;
    expect(puts[0]![0]).toBe(immutableKey);
    expect(puts[0]![1]).toBe(FORECAST);
  });

  it('returns the correct key paths', async () => {
    const { s3 } = makeMockS3();
    const result = await publishForecast(s3, INPUT);
    expect(result.publishedKey).toBe(
      `published/spot=${SPOT}/date=${DATE}/ruleset=${RULESET}/run=${RUN}.json`,
    );
    expect(result.dailyPointerKey).toBe(`current/spot=${SPOT}/date=${DATE}/default.json`);
    expect(result.latestPointerKey).toBe(`current/spot=${SPOT}/latest.json`);
  });

  it('writes daily and latest current pointers after the immutable object', async () => {
    const { s3, puts } = makeMockS3();
    await publishForecast(s3, INPUT);
    // 3 writes: immutable forecast + daily pointer + latest pointer
    expect(puts).toHaveLength(3);
    expect(puts[1]![0]).toBe(`current/spot=${SPOT}/date=${DATE}/default.json`);
    expect(puts[2]![0]).toBe(`current/spot=${SPOT}/latest.json`);
  });

  it('pointer document references the published key and run id', async () => {
    const { s3, puts } = makeMockS3();
    await publishForecast(s3, INPUT);
    const pointer = puts[1]![1] as Record<string, unknown>;
    expect(pointer.publishedKey).toBe(
      `published/spot=${SPOT}/date=${DATE}/ruleset=${RULESET}/run=${RUN}.json`,
    );
    expect(pointer.forecastRunId).toBe(RUN);
    expect(pointer.generatedAt).toBe(RUN);
  });

  it('does not update pointers when the immutable write throws ConditionalWriteError', async () => {
    const { s3, puts } = makeMockS3({
      putJson: vi.fn(async (key: string) => {
        throw new ConditionalWriteError(key);
      }),
    });
    await expect(publishForecast(s3, INPUT)).rejects.toBeInstanceOf(ConditionalWriteError);
    expect(puts).toHaveLength(0); // nothing was persisted via our tracker
    expect(s3.putJson).toHaveBeenCalledTimes(1); // only one write attempted
  });

  it('does not update pointers when verification fails (object missing after write)', async () => {
    const putCount = { n: 0 };
    const { s3 } = makeMockS3({
      putJson: vi.fn(async () => {
        putCount.n++;
      }),
      getJson: vi.fn(async () => null), // simulates missing object
    });
    await expect(publishForecast(s3, INPUT)).rejects.toBeInstanceOf(VerificationError);
    // Only the immutable write was attempted; no pointer writes
    expect(putCount.n).toBe(1);
  });

  it('does not update pointers when getJson throws during verification', async () => {
    const putCount = { n: 0 };
    const { s3 } = makeMockS3({
      putJson: vi.fn(async () => {
        putCount.n++;
      }),
      getJson: vi.fn(async () => {
        throw new Error('network error');
      }),
    });
    await expect(publishForecast(s3, INPUT)).rejects.toBeInstanceOf(VerificationError);
    expect(putCount.n).toBe(1);
  });

  it('throws ConditionalWriteError when the same run is published twice', async () => {
    const { s3 } = makeMockS3();
    await publishForecast(s3, INPUT);
    await expect(publishForecast(s3, INPUT)).rejects.toBeInstanceOf(ConditionalWriteError);
  });

  it('allows a second run with a different forecastRunId for the same spot and date', async () => {
    const { s3 } = makeMockS3();
    await publishForecast(s3, INPUT);
    const second = { ...INPUT, forecastRunId: '2026-07-26T07:00:00Z' };
    await expect(publishForecast(s3, second)).resolves.toBeDefined();
  });

  it('uses if-none-match on the immutable write', async () => {
    const { s3 } = makeMockS3();
    await publishForecast(s3, INPUT);
    expect(s3.putJson).toHaveBeenCalledWith(expect.stringContaining('published/'), FORECAST, {
      ifNoneMatch: true,
    });
  });

  it('does NOT use if-none-match on pointer writes', async () => {
    const { s3 } = makeMockS3();
    await publishForecast(s3, INPUT);
    const calls = vi.mocked(s3.putJson).mock.calls;
    // pointer writes (calls 1 and 2) should have no options or ifNoneMatch: false
    for (const call of calls.slice(1)) {
      expect(call[2]?.ifNoneMatch).toBeFalsy();
    }
  });
});

describe('ConditionalWriteError', () => {
  it('carries the key', () => {
    const err = new ConditionalWriteError('some/key.json');
    expect(err.key).toBe('some/key.json');
    expect(err.name).toBe('ConditionalWriteError');
  });
});

describe('VerificationError', () => {
  it('carries the key', () => {
    const err = new VerificationError('some/key.json');
    expect(err.key).toBe('some/key.json');
    expect(err.name).toBe('VerificationError');
  });
});
