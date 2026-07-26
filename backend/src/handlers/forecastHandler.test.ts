import { describe, expect, it, vi } from 'vitest';
import { createForecastHandler } from './forecastHandler.js';
import type { S3Reader } from './forecastHandler.js';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { PublishedSpotForecast } from '../generated/schema-types.js';
import type { CurrentPointer } from '../publisher.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SPOT_ID = 'west-dennis-beach-ma';
const DATE = '2026-07-26';
const FORECAST_RUN_ID = '2026-07-26T19:00:00.000Z';
const GENERATED_AT = '2026-07-26T19:00:00.000Z';
const EXPIRES_AT = '2026-07-26T23:00:00.000Z';
const PUBLISHED_KEY = `published/spot=${SPOT_ID}/date=${DATE}/ruleset=west-dennis-beach-ma-default/run=${FORECAST_RUN_ID}.json`;

const POINTER: CurrentPointer = {
  spotId: SPOT_ID,
  localDate: DATE,
  rulesetId: 'west-dennis-beach-ma-default',
  forecastRunId: FORECAST_RUN_ID,
  publishedKey: PUBLISHED_KEY,
  generatedAt: GENERATED_AT,
};

// Minimal published forecast stub
const FORECAST: Partial<PublishedSpotForecast> = {
  schemaVersion: '1.0',
  revision: FORECAST_RUN_ID,
  generatedAt: GENERATED_AT,
  expiresAt: EXPIRES_AT,
};

/** Build a minimal API Gateway v2 event. */
function makeEvent(
  overrides: Partial<APIGatewayProxyEventV2> & {
    pathParameters?: Record<string, string | undefined>;
    queryStringParameters?: Record<string, string | undefined>;
    headers?: Record<string, string | undefined>;
  } = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `GET /spots/{spotId}/forecast`,
    rawPath: `/spots/${SPOT_ID}/forecast`,
    rawQueryString: `date=${DATE}`,
    headers: {},
    pathParameters: { spotId: SPOT_ID },
    queryStringParameters: { date: DATE },
    requestContext: {
      requestId: 'test-request-id',
      accountId: '123456789',
      apiId: 'test-api',
      domainName: 'test.example.com',
      domainPrefix: 'test',
      http: {
        method: 'GET',
        path: `/spots/${SPOT_ID}/forecast`,
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
        userAgent: 'test',
      },
      routeKey: `GET /spots/{spotId}/forecast`,
      stage: '$default',
      time: '26/Jul/2026:19:00:00 +0000',
      timeEpoch: 1753552800000,
    },
    isBase64Encoded: false,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

/** Create a mock S3 reader. */
function makeS3(pointerResult: unknown = POINTER, forecastResult: unknown = FORECAST): S3Reader {
  return {
    getJson: vi.fn().mockImplementation(async (key: string) => {
      if (key.includes('current/')) return pointerResult;
      return forecastResult;
    }),
  };
}

// ─── 200 OK ───────────────────────────────────────────────────────────────────

describe('forecastHandler — 200 OK', () => {
  it('returns 200 for a valid spotId and date', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const result = await handler(makeEvent());
    expect((result as { statusCode: number }).statusCode).toBe(200);
  });

  it('response body is the serialized forecast', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const result = (await handler(makeEvent())) as { statusCode: number; body: string };
    const body = JSON.parse(result.body);
    expect(body.schemaVersion).toBe('1.0');
    expect(body.revision).toBe(FORECAST_RUN_ID);
  });

  it('includes Cache-Control header', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const result = (await handler(makeEvent())) as {
      statusCode: number;
      headers: Record<string, string>;
    };
    expect(result.headers['Cache-Control']).toContain('max-age=300');
  });

  it('includes ETag header with forecast revision', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const result = (await handler(makeEvent())) as {
      statusCode: number;
      headers: Record<string, string>;
    };
    expect(result.headers['ETag']).toBe(`"${FORECAST_RUN_ID}"`);
  });

  it('includes Last-Modified header', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const result = (await handler(makeEvent())) as {
      statusCode: number;
      headers: Record<string, string>;
    };
    expect(result.headers['Last-Modified']).toBeDefined();
  });

  it('includes X-Forecast-Generated-At header', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const result = (await handler(makeEvent())) as {
      statusCode: number;
      headers: Record<string, string>;
    };
    expect(result.headers['X-Forecast-Generated-At']).toBe(GENERATED_AT);
  });

  it('includes X-Forecast-Expires-At header', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const result = (await handler(makeEvent())) as {
      statusCode: number;
      headers: Record<string, string>;
    };
    expect(result.headers['X-Forecast-Expires-At']).toBe(EXPIRES_AT);
  });
});

// ─── 304 Not Modified ─────────────────────────────────────────────────────────

describe('forecastHandler — 304 Not Modified', () => {
  it('returns 304 when If-None-Match matches the current ETag', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const event = makeEvent({ headers: { 'if-none-match': `"${FORECAST_RUN_ID}"` } });
    const result = await handler(event);
    expect((result as { statusCode: number }).statusCode).toBe(304);
  });

  it('returns 200 when If-None-Match is present but does not match', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const event = makeEvent({ headers: { 'if-none-match': '"old-run-id"' } });
    const result = await handler(event);
    expect((result as { statusCode: number }).statusCode).toBe(200);
  });

  it('304 response has no body', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const event = makeEvent({ headers: { 'if-none-match': `"${FORECAST_RUN_ID}"` } });
    const result = (await handler(event)) as { statusCode: number; body?: string };
    expect(result.body).toBeUndefined();
  });

  it('304 response includes ETag header', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const event = makeEvent({ headers: { 'if-none-match': `"${FORECAST_RUN_ID}"` } });
    const result = (await handler(event)) as {
      statusCode: number;
      headers: Record<string, string>;
    };
    expect(result.headers['ETag']).toBe(`"${FORECAST_RUN_ID}"`);
  });
});

// ─── 400 Bad Request ──────────────────────────────────────────────────────────

describe('forecastHandler — 400 Bad Request', () => {
  it('returns 400 when spotId is missing', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const event = makeEvent({ pathParameters: {} });
    const result = await handler(event);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when date is missing', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const event = makeEvent({ queryStringParameters: {} });
    const result = await handler(event);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 for an invalid date format', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const event = makeEvent({ queryStringParameters: { date: '20260726' } });
    const result = await handler(event);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });

  it('400 response body follows the standard error envelope', async () => {
    const handler = createForecastHandler({ s3: makeS3() });
    const event = makeEvent({ pathParameters: {} });
    const result = (await handler(event)) as { statusCode: number; body: string };
    const body = JSON.parse(result.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.requestId).toBeDefined();
  });
});

// ─── 404 Not Found ────────────────────────────────────────────────────────────

describe('forecastHandler — 404 Not Found', () => {
  it('returns 404 when no current pointer exists for the date', async () => {
    const handler = createForecastHandler({ s3: makeS3(null) });
    const result = await handler(makeEvent());
    expect((result as { statusCode: number }).statusCode).toBe(404);
  });

  it('404 error code is FORECAST_NOT_AVAILABLE', async () => {
    const handler = createForecastHandler({ s3: makeS3(null) });
    const result = (await handler(makeEvent())) as { statusCode: number; body: string };
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('FORECAST_NOT_AVAILABLE');
  });

  it('404 error retryable is true (forecast may be published later)', async () => {
    const handler = createForecastHandler({ s3: makeS3(null) });
    const result = (await handler(makeEvent())) as { statusCode: number; body: string };
    const body = JSON.parse(result.body);
    expect(body.error.retryable).toBe(true);
  });
});

// ─── 500 Internal Error ───────────────────────────────────────────────────────

describe('forecastHandler — 500 Internal Error', () => {
  it('returns 500 when S3 throws an unexpected error', async () => {
    const errorS3: S3Reader = {
      getJson: vi.fn().mockRejectedValue(new Error('S3 connection timeout')),
    };
    const handler = createForecastHandler({ s3: errorS3 });
    const result = await handler(makeEvent());
    expect((result as { statusCode: number }).statusCode).toBe(500);
  });

  it('500 error code is INTERNAL_ERROR', async () => {
    const errorS3: S3Reader = {
      getJson: vi.fn().mockRejectedValue(new Error('S3 timeout')),
    };
    const handler = createForecastHandler({ s3: errorS3 });
    const result = (await handler(makeEvent())) as { statusCode: number; body: string };
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── S3 key usage ─────────────────────────────────────────────────────────────

describe('forecastHandler — S3 key usage', () => {
  it('reads the daily pointer key first', async () => {
    const s3 = makeS3();
    const handler = createForecastHandler({ s3 });
    await handler(makeEvent());
    const calls = (s3.getJson as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(calls[0]![0]).toContain('current/');
    expect(calls[0]![0]).toContain(SPOT_ID);
    expect(calls[0]![0]).toContain(DATE);
  });

  it('reads the published forecast from the pointer publishedKey', async () => {
    const s3 = makeS3();
    const handler = createForecastHandler({ s3 });
    await handler(makeEvent());
    const calls = (s3.getJson as ReturnType<typeof vi.fn>).mock.calls as [string][];
    expect(calls[1]![0]).toBe(PUBLISHED_KEY);
  });
});
