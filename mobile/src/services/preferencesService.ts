/**
 * Preferences service — GET and PUT /me/preferences with ETag support.
 *
 * ETags enable optimistic concurrency:
 *   1. GET returns the current ETag.
 *   2. PUT sends the ETag in If-Match.
 *   3. If the server returns 409, the caller must re-fetch and retry.
 *
 * Tokens are stored securely by Amplify (Keychain / Keystore) and
 * attached automatically; this service only manages HTTP mechanics.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type WindDirectionSector =
  'DIRECT_ONSHORE' | 'SIDE_ONSHORE' | 'CROSS_SHORE' | 'SIDE_OFFSHORE' | 'OFFSHORE';

export interface UserPreferences {
  schemaVersion: 1;
  userId: string;
  updatedAt: string;
  windSpeed: {
    minimumUsableKnots: number;
    preferredMinKnots: number;
    preferredMaxKnots: number;
    absoluteMaxKnots: number;
  };
  windDirection: {
    acceptedSectors: WindDirectionSector[];
  };
  gust: {
    maxGustFactorRatio: number;
  };
  notifications?: {
    enabled: boolean;
    windowOpenAlertMinutesBefore?: number;
  };
}

export interface PreferencesResult {
  preferences: UserPreferences;
  etag: string;
}

export interface UpdatePreferencesInput {
  /** Preferences body to PUT. Server overwrites userId/schemaVersion/updatedAt. */
  preferences: Omit<UserPreferences, 'schemaVersion' | 'userId' | 'updatedAt'>;
  /** ETag from the last GET — sent as If-Match for conditional write. */
  etag?: string;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class PreferencesNotFoundError extends Error {
  constructor() {
    super('No preferences found for this user');
    this.name = 'PreferencesNotFoundError';
  }
}

export class EtagConflictError extends Error {
  constructor() {
    super('Preferences were modified by another request. Fetch the latest and retry.');
    this.name = 'EtagConflictError';
  }
}

export class PreferencesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreferencesValidationError';
  }
}

// ─── HTTP adapter interface ───────────────────────────────────────────────────

/**
 * Minimal HTTP client interface.
 * Production implementation uses the Amplify REST API client.
 * Test implementation uses a simple mock.
 */
export interface HttpClient {
  get(
    path: string,
    headers?: Record<string, string>,
  ): Promise<{
    status: number;
    body: unknown;
    headers: Record<string, string>;
  }>;
  put(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<{
    status: number;
    body: unknown;
    headers: Record<string, string>;
  }>;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class PreferencesService {
  readonly #http: HttpClient;
  readonly #basePath: string;

  constructor(http: HttpClient, basePath = '/me/preferences') {
    this.#http = http;
    this.#basePath = basePath;
  }

  /**
   * Fetch the current preferences and their ETag.
   * @param cachedEtag When provided, sends If-None-Match; returns null on 304.
   */
  async get(cachedEtag?: string): Promise<PreferencesResult | null> {
    const headers: Record<string, string> = {};
    if (cachedEtag !== undefined) {
      headers['If-None-Match'] = cachedEtag;
    }

    const res = await this.#http.get(this.#basePath, headers);

    if (res.status === 304) return null;
    if (res.status === 404) throw new PreferencesNotFoundError();
    if (res.status !== 200) {
      throw new Error(`GET preferences failed with status ${res.status}`);
    }

    const etag = (res.headers['etag'] ?? '').replace(/^"|"$/g, '');
    return { preferences: res.body as UserPreferences, etag };
  }

  /**
   * Update preferences with optimistic concurrency.
   * @throws EtagConflictError when the server returns 409 (stale ETag).
   * @throws PreferencesValidationError when the server returns 422.
   */
  async update(input: UpdatePreferencesInput): Promise<PreferencesResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (input.etag !== undefined) {
      headers['If-Match'] = `"${input.etag}"`;
    }

    const res = await this.#http.put(this.#basePath, input.preferences, headers);

    if (res.status === 409) throw new EtagConflictError();
    if (res.status === 422) {
      const body = res.body as { error?: { message?: string } };
      throw new PreferencesValidationError(body.error?.message ?? 'Validation failed');
    }
    if (res.status !== 200) {
      throw new Error(`PUT preferences failed with status ${res.status}`);
    }

    const etag = (res.headers['etag'] ?? '').replace(/^"|"$/g, '');
    return { preferences: res.body as UserPreferences, etag };
  }
}
