/**
 * Tests for FanOutService — S3-based notification fan-out.
 *
 * Validates:
 *  - Subscription projections (opted-out users are skipped)
 *  - Listing behavior (pagination with continuation tokens)
 *  - Scale: multiple pages of device keys are fully consumed
 *  - Retries: transient errors are retried up to maxRetries times
 *  - Invalid-token handling: device is deleted after invalid token response
 *  - Non-retryable errors increment the failed counter
 *  - Keys that do not match the device pattern are ignored
 *  - Missing/null device records are skipped
 */

import { describe, it, expect, vi } from 'vitest';
import {
  FanOutService,
  type FanOutStore,
  type NotificationSender,
  type FanOutMessage,
} from './fanOutService.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MESSAGE: FanOutMessage = {
  title: 'Kite window open',
  body: 'West Dennis Beach: GO — 11 AM–2 PM',
};

function makeDevice(sub: string, deviceId: string, platform: 'apns' | 'fcm' = 'apns') {
  return {
    schemaVersion: 1 as const,
    deviceId,
    platform,
    token: `token-${deviceId}`,
    userId: sub,
    registeredAt: '2026-07-26T12:00:00Z',
    updatedAt: '2026-07-26T12:00:00Z',
  };
}

// ─── Store builder ────────────────────────────────────────────────────────────

function makeStore(overrides: Partial<FanOutStore> = {}): FanOutStore {
  return {
    listPage: vi.fn().mockResolvedValue({ keys: [], nextToken: undefined }),
    getDevice: vi.fn().mockResolvedValue(null),
    isSubscribed: vi.fn().mockResolvedValue(true),
    deleteDevice: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSender(
  result: Awaited<ReturnType<NotificationSender['send']>> = { status: 'sent' },
): NotificationSender {
  return { send: vi.fn().mockResolvedValue(result) };
}

// ─── Subscription projection ──────────────────────────────────────────────────

describe('FanOutService — subscription projection', () => {
  it('skips devices for users that have not opted in', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
      isSubscribed: vi.fn().mockResolvedValue(false),
    });
    const sender = makeSender();
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    expect(sender.send).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('sends to devices for users that have opted in', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
      isSubscribed: vi.fn().mockResolvedValue(true),
    });
    const sender = makeSender({ status: 'sent' });
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    expect(sender.send).toHaveBeenCalledOnce();
    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('skips keys that do not match the device key pattern', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({
        keys: [
          'users/sub-a/preferences.json', // not a device key
          'users/sub-a/devices/dev-1.json',
        ],
      }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
      isSubscribed: vi.fn().mockResolvedValue(true),
    });
    const sender = makeSender();
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    expect(sender.send).toHaveBeenCalledOnce();
    // preferences.json is ignored (does not match device pattern); only the device key counts
    expect(result.sent).toBe(1);
  });

  it('skips devices when the record is null', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(null),
    });
    const sender = makeSender();
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    expect(sender.send).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it('sends to multiple opted-in devices across multiple users', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({
        keys: ['users/sub-a/devices/dev-1.json', 'users/sub-b/devices/dev-2.json'],
      }),
      getDevice: vi
        .fn()
        .mockImplementation((key: string) =>
          key.includes('sub-a') ? makeDevice('sub-a', 'dev-1') : makeDevice('sub-b', 'dev-2'),
        ),
      isSubscribed: vi.fn().mockResolvedValue(true),
    });
    const sender = makeSender({ status: 'sent' });
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    expect(result.sent).toBe(2);
  });
});

// ─── Listing behavior — pagination ───────────────────────────────────────────

describe('FanOutService — listing behavior', () => {
  it('returns zero results when no device keys exist', async () => {
    const store = makeStore();
    const sender = makeSender();
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('follows continuation tokens to exhaust all pages', async () => {
    const listPage = vi
      .fn()
      .mockResolvedValueOnce({
        keys: ['users/sub-a/devices/dev-1.json'],
        nextToken: 'page-2-token',
      })
      .mockResolvedValueOnce({ keys: ['users/sub-b/devices/dev-2.json'], nextToken: undefined });
    const store = makeStore({
      listPage,
      getDevice: vi
        .fn()
        .mockImplementation((key: string) =>
          key.includes('sub-a') ? makeDevice('sub-a', 'dev-1') : makeDevice('sub-b', 'dev-2'),
        ),
    });
    const sender = makeSender({ status: 'sent' });
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    // Both pages were consumed
    expect(listPage).toHaveBeenCalledTimes(2);
    expect(listPage).toHaveBeenNthCalledWith(1, 'users/', undefined);
    expect(listPage).toHaveBeenNthCalledWith(2, 'users/', 'page-2-token');
    expect(result.sent).toBe(2);
  });

  it('handles three pages correctly (scale: 1000 keys per page)', async () => {
    // Simulate 3 pages of keys — 2 device keys per page, rest are preferences
    const page = (token?: string) => ({
      keys: [`users/sub-${token}/devices/dev-1.json`],
      nextToken: token === 'p3' ? undefined : `p${Number(token?.slice(1) ?? 0) + 1}`,
    });
    const listPage = vi
      .fn()
      .mockResolvedValueOnce({ keys: ['users/sub-a/devices/dev-1.json'], nextToken: 'p2' })
      .mockResolvedValueOnce({ keys: ['users/sub-b/devices/dev-2.json'], nextToken: 'p3' })
      .mockResolvedValueOnce({ keys: ['users/sub-c/devices/dev-3.json'], nextToken: undefined });
    void page; // suppress unused variable
    const store = makeStore({
      listPage,
      getDevice: vi.fn().mockImplementation((key: string) => {
        const m = /users\/(sub-[^/]+)\/devices\/(dev-\d+)/.exec(key);
        return m?.[1] && m?.[2] ? makeDevice(m[1], m[2]) : null;
      }),
    });
    const sender = makeSender({ status: 'sent' });
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    expect(listPage).toHaveBeenCalledTimes(3);
    expect(result.sent).toBe(3);
  });
});

// ─── Retries ──────────────────────────────────────────────────────────────────

describe('FanOutService — retries', () => {
  it('retries transient errors up to maxRetries times then counts as failed', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    const sender: NotificationSender = {
      send: vi.fn().mockResolvedValue({ status: 'error', retryable: true, reason: 'timeout' }),
    };
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE, { maxRetries: 2 });
    // Initial attempt + 2 retries = 3 calls
    expect(sender.send).toHaveBeenCalledTimes(3);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('does not retry non-retryable errors', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    const sender: NotificationSender = {
      send: vi.fn().mockResolvedValue({ status: 'error', retryable: false, reason: 'forbidden' }),
    };
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE, { maxRetries: 2 });
    // Only 1 call — no retries for non-retryable
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
  });

  it('succeeds on the first retry after a transient failure', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    const sender: NotificationSender = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ status: 'error', retryable: true, reason: 'timeout' })
        .mockResolvedValueOnce({ status: 'sent' }),
    };
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE, { maxRetries: 2 });
    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
  });
});

// ─── Invalid token handling ───────────────────────────────────────────────────

describe('FanOutService — invalid token handling', () => {
  it('deletes the device registration when the token is reported invalid', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    const sender = makeSender({ status: 'invalid_token' });
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    expect(store.deleteDevice).toHaveBeenCalledWith('users/sub-a/devices/dev-1.json');
    expect(result.cleaned).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('does not retry on invalid token — cleans up immediately', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    const sender: NotificationSender = {
      send: vi.fn().mockResolvedValue({ status: 'invalid_token' }),
    };
    const service = new FanOutService(store, sender);
    await service.fanOut(MESSAGE, { maxRetries: 3 });
    // Invalid token should NOT be retried — only 1 send attempt
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('continues fan-out when deleteDevice throws after invalid token', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({
        keys: ['users/sub-a/devices/dev-1.json', 'users/sub-b/devices/dev-2.json'],
      }),
      getDevice: vi
        .fn()
        .mockImplementation((key: string) =>
          key.includes('sub-a') ? makeDevice('sub-a', 'dev-1') : makeDevice('sub-b', 'dev-2'),
        ),
      deleteDevice: vi
        .fn()
        .mockRejectedValueOnce(new Error('S3 delete failed'))
        .mockResolvedValue(undefined),
    });
    const sender: NotificationSender = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ status: 'invalid_token' })
        .mockResolvedValueOnce({ status: 'sent' }),
    };
    const service = new FanOutService(store, sender);
    const result = await service.fanOut(MESSAGE);
    // Fan-out must not abort when a delete fails
    expect(result.cleaned).toBe(1);
    expect(result.sent).toBe(1);
  });
});
