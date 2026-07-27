/**
 * Tests for PreferencesService — ETag handling, conflict detection, validation errors.
 */
import {
  PreferencesService,
  EtagConflictError,
  PreferencesNotFoundError,
  PreferencesValidationError,
  type HttpClient,
  type WindDirectionSector,
} from '../services/preferencesService';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ETAG = 'abc123';
const VALID_PREFS_BODY = {
  windSpeed: {
    minimumUsableKnots: 12,
    preferredMinKnots: 15,
    preferredMaxKnots: 25,
    absoluteMaxKnots: 30,
  },
  windDirection: { acceptedSectors: ['DIRECT_ONSHORE', 'SIDE_ONSHORE'] as WindDirectionSector[] },
  gust: { maxGustFactorRatio: 1.4 },
};
const STORED_PREFS = {
  schemaVersion: 1 as const,
  userId: 'user-sub-123',
  updatedAt: '2026-07-17T14:30:00Z',
  ...VALID_PREFS_BODY,
};

function makeHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    get: jest.fn().mockResolvedValue({
      status: 200,
      body: STORED_PREFS,
      headers: { etag: `"${ETAG}"` },
    }),
    put: jest.fn().mockResolvedValue({
      status: 200,
      body: STORED_PREFS,
      headers: { etag: '"new-etag"' },
    }),
    ...overrides,
  };
}

// ─── GET tests ────────────────────────────────────────────────────────────────

describe('PreferencesService.get', () => {
  it('returns preferences and stripped ETag on 200', async () => {
    const service = new PreferencesService(makeHttp());
    const result = await service.get();
    expect(result).not.toBeNull();
    expect(result!.preferences.userId).toBe('user-sub-123');
    expect(result!.etag).toBe(ETAG); // quotes stripped
  });

  it('sends If-None-Match when cachedEtag is provided', async () => {
    const http = makeHttp();
    const service = new PreferencesService(http);
    await service.get(ETAG);
    expect(http.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ 'If-None-Match': ETAG }),
    );
  });

  it('returns null on 304', async () => {
    const http = makeHttp({
      get: jest.fn().mockResolvedValue({ status: 304, body: {}, headers: {} }),
    });
    const service = new PreferencesService(http);
    expect(await service.get(ETAG)).toBeNull();
  });

  it('throws PreferencesNotFoundError on 404', async () => {
    const http = makeHttp({
      get: jest.fn().mockResolvedValue({ status: 404, body: {}, headers: {} }),
    });
    const service = new PreferencesService(http);
    await expect(service.get()).rejects.toBeInstanceOf(PreferencesNotFoundError);
  });

  it('throws on unexpected status', async () => {
    const http = makeHttp({
      get: jest.fn().mockResolvedValue({ status: 500, body: {}, headers: {} }),
    });
    const service = new PreferencesService(http);
    await expect(service.get()).rejects.toThrow('500');
  });
});

// ─── PUT tests ────────────────────────────────────────────────────────────────

describe('PreferencesService.update', () => {
  it('returns updated preferences and new ETag on 200', async () => {
    const service = new PreferencesService(makeHttp());
    const result = await service.update({ preferences: VALID_PREFS_BODY, etag: ETAG });
    expect(result.etag).toBe('new-etag');
  });

  it('sends If-Match header when etag is provided', async () => {
    const http = makeHttp();
    const service = new PreferencesService(http);
    await service.update({ preferences: VALID_PREFS_BODY, etag: ETAG });
    expect(http.put).toHaveBeenCalledWith(
      expect.any(String),
      VALID_PREFS_BODY,
      expect.objectContaining({ 'If-Match': `"${ETAG}"` }),
    );
  });

  it('does not send If-Match when etag is undefined', async () => {
    const http = makeHttp();
    const service = new PreferencesService(http);
    await service.update({ preferences: VALID_PREFS_BODY });
    const headers = (http.put as jest.Mock).mock.calls[0]?.[2] as Record<string, string>;
    expect(headers['If-Match']).toBeUndefined();
  });

  it('throws EtagConflictError on 409', async () => {
    const http = makeHttp({
      put: jest.fn().mockResolvedValue({ status: 409, body: {}, headers: {} }),
    });
    const service = new PreferencesService(http);
    await expect(
      service.update({ preferences: VALID_PREFS_BODY, etag: 'stale' }),
    ).rejects.toBeInstanceOf(EtagConflictError);
  });

  it('throws PreferencesValidationError on 422', async () => {
    const http = makeHttp({
      put: jest.fn().mockResolvedValue({
        status: 422,
        body: { error: { message: 'Bad wind speed' } },
        headers: {},
      }),
    });
    const service = new PreferencesService(http);
    await expect(service.update({ preferences: VALID_PREFS_BODY })).rejects.toBeInstanceOf(
      PreferencesValidationError,
    );
  });

  it('throws on unexpected status', async () => {
    const http = makeHttp({
      put: jest.fn().mockResolvedValue({ status: 500, body: {}, headers: {} }),
    });
    const service = new PreferencesService(http);
    await expect(service.update({ preferences: VALID_PREFS_BODY })).rejects.toThrow('500');
  });
});
