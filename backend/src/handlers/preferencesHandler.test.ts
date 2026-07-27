import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createPreferencesHandler,
  EtagConflictError,
  type S3PreferencesStore,
} from './preferencesHandler.js';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ETAG = 'abc123etag';

const VALID_PREFERENCES_BODY = {
  windSpeed: {
    minimumUsableKnots: 12,
    preferredMinKnots: 15,
    preferredMaxKnots: 25,
    absoluteMaxKnots: 30,
  },
  windDirection: { acceptedSectors: ['DIRECT_ONSHORE', 'SIDE_ONSHORE'] },
  gust: { maxGustFactorRatio: 1.4 },
};

const STORED_PREFERENCES = {
  schemaVersion: 1 as const,
  userId: USER_ID,
  updatedAt: '2026-07-17T14:30:00Z',
  ...VALID_PREFERENCES_BODY,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** APIGatewayProxyResultV2 is string | structured. Cast to structured for assertions. */
function asResult(value: unknown): APIGatewayProxyStructuredResultV2 {
  return value as APIGatewayProxyStructuredResultV2;
}

// ─── Event builder ─────────────────────────────────────────────────────────────

function makeEvent(
  method: 'GET' | 'PUT',
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} /me/preferences`,
    rawPath: '/me/preferences',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test.example.com',
      domainPrefix: 'test',
      requestId: 'test-request-id',
      routeKey: `${method} /me/preferences`,
      stage: '$default',
      time: '2026-07-17T14:30:00Z',
      timeEpoch: 1721227800000,
      http: {
        method,
        path: '/me/preferences',
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
        userAgent: 'TestAgent/1.0',
      },
      authorizer: {
        jwt: {
          claims: { sub: USER_ID },
          scopes: [],
        },
      },
    },
    isBase64Encoded: false,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

// ─── Store mock builder ────────────────────────────────────────────────────────

function makeStore(overrides: Partial<S3PreferencesStore> = {}): S3PreferencesStore {
  return {
    getWithEtag: vi.fn().mockResolvedValue({ body: STORED_PREFERENCES, etag: ETAG }),
    putJson: vi.fn().mockResolvedValue('new-etag-456'),
    ...overrides,
  };
}

// ─── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /me/preferences', () => {
  it('returns 200 with preferences and ETag', async () => {
    const handler = createPreferencesHandler({ store: makeStore() });
    const res = asResult(await handler(makeEvent('GET')));
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['ETag']).toBe(`"${ETAG}"`);
    expect(res.headers?.['Cache-Control']).toBe('private, no-store');
    const body = JSON.parse(res.body ?? '');
    expect(body.userId).toBe(USER_ID);
  });

  it('returns 304 when If-None-Match matches stored ETag', async () => {
    const handler = createPreferencesHandler({ store: makeStore() });
    const res = asResult(
      await handler(makeEvent('GET', { headers: { 'if-none-match': `"${ETAG}"` } })),
    );
    expect(res.statusCode).toBe(304);
    expect(res.headers?.['ETag']).toBe(`"${ETAG}"`);
    expect(res.body).toBeUndefined();
  });

  it('returns 404 when no preferences exist', async () => {
    const store = makeStore({ getWithEtag: vi.fn().mockResolvedValue(null) });
    const handler = createPreferencesHandler({ store });
    const res = asResult(await handler(makeEvent('GET')));
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body ?? '');
    expect(body.error.code).toBe('PREFERENCES_NOT_FOUND');
  });

  it('returns 401 when no Cognito sub is present', async () => {
    const handler = createPreferencesHandler({ store: makeStore() });
    const event = makeEvent('GET');
    // @ts-expect-error — intentionally removing authorizer
    event.requestContext.authorizer = undefined;
    const res = asResult(await handler(event));
    expect(res.statusCode).toBe(401);
  });

  it('includes x-correlation-id in response headers', async () => {
    const handler = createPreferencesHandler({ store: makeStore() });
    const res = asResult(
      await handler(makeEvent('GET', { headers: { 'x-correlation-id': 'trace-123' } })),
    );
    expect(res.headers?.['x-correlation-id']).toBe('trace-123');
  });
});

// ─── PUT tests ─────────────────────────────────────────────────────────────────

describe('PUT /me/preferences', () => {
  it('returns 200 with updated preferences and new ETag', async () => {
    const handler = createPreferencesHandler({ store: makeStore() });
    const res = asResult(
      await handler(makeEvent('PUT', { body: JSON.stringify(VALID_PREFERENCES_BODY) })),
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['ETag']).toBe('"new-etag-456"');
    const body = JSON.parse(res.body ?? '');
    expect(body.userId).toBe(USER_ID);
    expect(body.schemaVersion).toBe(1);
    expect(typeof body.updatedAt).toBe('string');
  });

  it('passes If-Match ETag to the store for conditional write', async () => {
    const store = makeStore();
    const handler = createPreferencesHandler({ store });
    await handler(
      makeEvent('PUT', {
        body: JSON.stringify(VALID_PREFERENCES_BODY),
        headers: { 'if-match': `"${ETAG}"` },
      }),
    );
    expect(store.putJson).toHaveBeenCalledWith(
      expect.stringContaining(USER_ID),
      expect.any(Object),
      ETAG, // stripped of quotes
    );
  });

  it('returns 409 when store throws EtagConflictError', async () => {
    const store = makeStore({
      putJson: vi.fn().mockRejectedValue(new EtagConflictError()),
    });
    const handler = createPreferencesHandler({ store });
    const res = asResult(
      await handler(
        makeEvent('PUT', {
          body: JSON.stringify(VALID_PREFERENCES_BODY),
          headers: { 'if-match': '"stale-etag"' },
        }),
      ),
    );
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body ?? '');
    expect(body.error.code).toBe('ETAG_CONFLICT');
    expect(body.error.retryable).toBe(true);
  });

  it('returns 400 for non-JSON body', async () => {
    const handler = createPreferencesHandler({ store: makeStore() });
    const res = asResult(await handler(makeEvent('PUT', { body: 'not json' })));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body ?? '');
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 422 when body is missing required windSpeed fields', async () => {
    const handler = createPreferencesHandler({ store: makeStore() });
    const res = asResult(
      await handler(
        makeEvent('PUT', {
          body: JSON.stringify({
            windSpeed: {},
            windDirection: { acceptedSectors: ['DIRECT_ONSHORE'] },
            gust: { maxGustFactorRatio: 1.4 },
          }),
        }),
      ),
    );
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body ?? '');
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 when acceptedSectors is empty', async () => {
    const handler = createPreferencesHandler({ store: makeStore() });
    const invalid = { ...VALID_PREFERENCES_BODY, windDirection: { acceptedSectors: [] } };
    const res = asResult(await handler(makeEvent('PUT', { body: JSON.stringify(invalid) })));
    expect(res.statusCode).toBe(422);
  });

  it('server overwrites schemaVersion, userId, and updatedAt', async () => {
    const store = makeStore();
    const handler = createPreferencesHandler({ store });
    const bodyWithStaleFields = {
      ...VALID_PREFERENCES_BODY,
      schemaVersion: 99,
      userId: 'wrong-user',
      updatedAt: '1970-01-01T00:00:00Z',
    };
    await handler(makeEvent('PUT', { body: JSON.stringify(bodyWithStaleFields) }));
    const stored = (store.putJson as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(stored['schemaVersion']).toBe(1);
    expect(stored['userId']).toBe(USER_ID);
    expect(stored['updatedAt']).not.toBe('1970-01-01T00:00:00Z');
  });
});

// ─── Error cases ────────────────────────────────────────────────────────────────

describe('error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 500 on unexpected store error', async () => {
    const store = makeStore({
      getWithEtag: vi.fn().mockRejectedValue(new Error('S3 timeout')),
    });
    const handler = createPreferencesHandler({ store });
    const res = asResult(await handler(makeEvent('GET')));
    expect(res.statusCode).toBe(500);
  });
});
