/**
 * Tests for deviceHandler — PUT and DELETE device registration routes.
 *
 * Covers:
 *  - Token registration (PUT creates a new record)
 *  - Token replacement (PUT with same deviceId updates token, preserves registeredAt)
 *  - Invalid token cleanup (DELETE removes the record idempotently)
 *  - User/device S3 key structure
 *  - Authentication guard (missing userId → 401)
 *  - Validation (missing platform / invalid platform / empty token → 422)
 *  - Missing deviceId path param → 400
 *  - Unsupported method → 405
 *  - Store error → 500
 */

import { describe, it, expect, vi } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createDeviceHandler, type DeviceStore } from './deviceHandler.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** APIGatewayProxyResultV2 is string | structured. Cast to structured for assertions. */
function asResult(value: unknown): APIGatewayProxyStructuredResultV2 {
  return value as APIGatewayProxyStructuredResultV2;
}

function makeStore(overrides: Partial<DeviceStore> = {}): DeviceStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    listKeys: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeEvent(
  method: string,
  deviceId: string | undefined,
  body: unknown,
  userId = 'user-sub-123',
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} /me/devices/{deviceId}`,
    rawPath: `/me/devices/${deviceId ?? ''}`,
    rawQueryString: '',
    headers: {},
    pathParameters: deviceId !== undefined ? { deviceId } : undefined,
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: {
        method,
        path: '/me/devices',
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
        userAgent: 'test',
      },
      requestId: 'req-1',
      routeKey: `${method} /me/devices/{deviceId}`,
      stage: '$default',
      time: '26/Jul/2026:00:00:00 +0000',
      timeEpoch: 1753488000000,
      authorizer: {
        jwt: {
          claims: { sub: userId },
        },
      },
    } as unknown as APIGatewayProxyEventV2['requestContext'],
    body: body !== undefined ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

// ─── PUT tests ────────────────────────────────────────────────────────────────

describe('deviceHandler PUT', () => {
  it('registers a new device and returns 200 with the record', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(
      await handler(makeEvent('PUT', 'device-abc', { platform: 'apns', token: 'tok-1' })),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.deviceId).toBe('device-abc');
    expect(body.platform).toBe('apns');
    expect(body.token).toBe('tok-1');
    expect(body.userId).toBe('user-sub-123');
    expect(body.schemaVersion).toBe(1);
    expect(typeof body.registeredAt).toBe('string');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('writes to the correct S3 key (user/device path)', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    await handler(makeEvent('PUT', 'device-abc', { platform: 'fcm', token: 'tok-2' }, 'sub-xyz'));
    expect(store.put).toHaveBeenCalledWith(
      'users/sub-xyz/devices/device-abc.json',
      expect.objectContaining({ deviceId: 'device-abc', userId: 'sub-xyz' }),
    );
  });

  it('replaces token and preserves registeredAt for an existing device', async () => {
    const existingRecord = {
      schemaVersion: 1,
      deviceId: 'device-abc',
      platform: 'apns',
      token: 'old-token',
      userId: 'user-sub-123',
      registeredAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const store = makeStore({ get: vi.fn().mockResolvedValue(existingRecord) });
    const handler = createDeviceHandler({ store });
    const res = asResult(
      await handler(makeEvent('PUT', 'device-abc', { platform: 'apns', token: 'new-token' })),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body as string);
    expect(body.token).toBe('new-token');
    expect(body.registeredAt).toBe('2026-01-01T00:00:00Z'); // preserved
    expect(body.updatedAt).not.toBe('2026-01-01T00:00:00Z'); // refreshed
  });

  it('returns 401 when userId is missing from JWT claims', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(
      await handler(makeEvent('PUT', 'device-abc', { platform: 'apns', token: 'tok' }, '')),
    );
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when deviceId path parameter is missing', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(
      await handler(makeEvent('PUT', undefined, { platform: 'apns', token: 'tok' })),
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 when platform is missing', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(await handler(makeEvent('PUT', 'device-abc', { token: 'tok' })));
    expect(res.statusCode).toBe(422);
  });

  it('returns 422 when platform is invalid', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(
      await handler(makeEvent('PUT', 'device-abc', { platform: 'webpush', token: 'tok' })),
    );
    expect(res.statusCode).toBe(422);
  });

  it('returns 422 when token is empty', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(
      await handler(makeEvent('PUT', 'device-abc', { platform: 'fcm', token: '' })),
    );
    expect(res.statusCode).toBe(422);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const event = makeEvent('PUT', 'device-abc', undefined);
    (event as unknown as Record<string, unknown>)['body'] = '{bad json';
    const res = asResult(await handler(event));
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when the store throws', async () => {
    const store = makeStore({ put: vi.fn().mockRejectedValue(new Error('S3 error')) });
    const handler = createDeviceHandler({ store });
    const res = asResult(
      await handler(makeEvent('PUT', 'device-abc', { platform: 'apns', token: 'tok' })),
    );
    expect(res.statusCode).toBe(500);
  });
});

// ─── DELETE tests ─────────────────────────────────────────────────────────────

describe('deviceHandler DELETE', () => {
  it('removes the device and returns 204', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(await handler(makeEvent('DELETE', 'device-abc', undefined)));
    expect(res.statusCode).toBe(204);
    expect(store.delete).toHaveBeenCalledWith('users/user-sub-123/devices/device-abc.json');
  });

  it('is idempotent — 204 when the device key does not exist', async () => {
    const store = makeStore({ delete: vi.fn().mockResolvedValue(undefined) });
    const handler = createDeviceHandler({ store });
    const res = asResult(await handler(makeEvent('DELETE', 'no-such-device', undefined)));
    expect(res.statusCode).toBe(204);
  });

  it('returns 401 when userId is missing', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(await handler(makeEvent('DELETE', 'device-abc', undefined, '')));
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 when deviceId path parameter is missing', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(await handler(makeEvent('DELETE', undefined, undefined)));
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when the store throws', async () => {
    const store = makeStore({ delete: vi.fn().mockRejectedValue(new Error('S3 error')) });
    const handler = createDeviceHandler({ store });
    const res = asResult(await handler(makeEvent('DELETE', 'device-abc', undefined)));
    expect(res.statusCode).toBe(500);
  });
});

// ─── Method guard ─────────────────────────────────────────────────────────────

describe('deviceHandler method guard', () => {
  it('returns 405 for unsupported methods', async () => {
    const store = makeStore();
    const handler = createDeviceHandler({ store });
    const res = asResult(await handler(makeEvent('GET', 'device-abc', undefined)));
    expect(res.statusCode).toBe(405);
  });
});
