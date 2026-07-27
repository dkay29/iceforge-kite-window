/**
 * Tests for NotificationDispatcher — idempotent, preference-aware, observable.
 *
 * Covers:
 *  - Idempotency: duplicate runs are skipped when sent marker exists
 *  - Sent marker written after a successful fan-out
 *  - Fan-out is invoked with the correct message and options
 *  - Result counts are returned after dispatch
 *  - Returns null when run is a duplicate (marker present)
 *  - Observability: logs are not tested directly but the dispatch completes
 *    without throwing (log calls are side effects)
 */

import { describe, it, expect, vi } from 'vitest';
import { NotificationDispatcher, type DispatchStore } from './notificationDispatcher.js';
import type { NotificationSender, FanOutMessage } from '../fanOut/fanOutService.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SPOT = 'west-dennis-beach-ma';
const DATE = '2026-07-26';
const RUN = '2026-07-26T18:00:00Z';

const MESSAGE: FanOutMessage = {
  title: 'Kite window open',
  body: 'West Dennis Beach: GO — 11 AM–2 PM',
};

function makeDevice(sub: string, deviceId: string) {
  return {
    schemaVersion: 1 as const,
    deviceId,
    platform: 'apns' as const,
    token: `tok-${deviceId}`,
    userId: sub,
    registeredAt: '2026-07-26T12:00:00Z',
    updatedAt: '2026-07-26T12:00:00Z',
  };
}

// ─── Store builder ────────────────────────────────────────────────────────────

function makeStore(overrides: Partial<DispatchStore> = {}): DispatchStore {
  return {
    sentMarkerExists: vi.fn().mockResolvedValue(false),
    writeSentMarker: vi.fn().mockResolvedValue(undefined),
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

function makeInput() {
  return { spotId: SPOT, localDate: DATE, forecastRunId: RUN, message: MESSAGE };
}

// ─── Idempotency and duplicate suppression ────────────────────────────────────

describe('NotificationDispatcher — idempotency', () => {
  it('returns null and skips fan-out when sent marker already exists', async () => {
    const store = makeStore({ sentMarkerExists: vi.fn().mockResolvedValue(true) });
    const sender = makeSender();
    const dispatcher = new NotificationDispatcher(store, sender);
    const result = await dispatcher.dispatch(makeInput());
    expect(result).toBeNull();
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('writes the sent marker after a successful fan-out', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    const sender = makeSender({ status: 'sent' });
    const dispatcher = new NotificationDispatcher(store, sender);
    await dispatcher.dispatch(makeInput());
    expect(store.writeSentMarker).toHaveBeenCalledWith(
      expect.stringContaining('sent.json'),
      expect.objectContaining({
        spotId: SPOT,
        localDate: DATE,
        forecastRunId: RUN,
        result: expect.objectContaining({ sent: 1 }),
      }),
    );
  });

  it('checks the correct S3 marker key for the run', async () => {
    const store = makeStore();
    const dispatcher = new NotificationDispatcher(store, makeSender());
    await dispatcher.dispatch(makeInput());
    expect(store.sentMarkerExists).toHaveBeenCalledWith(
      `notifications/spot=${SPOT}/date=${DATE}/run=${RUN}/sent.json`,
    );
  });

  it('does not write a marker when fan-out is skipped (duplicate)', async () => {
    const store = makeStore({ sentMarkerExists: vi.fn().mockResolvedValue(true) });
    const dispatcher = new NotificationDispatcher(store, makeSender());
    await dispatcher.dispatch(makeInput());
    expect(store.writeSentMarker).not.toHaveBeenCalled();
  });
});

// ─── Fan-out invocation ───────────────────────────────────────────────────────

describe('NotificationDispatcher — fan-out', () => {
  it('returns the fan-out result after dispatch', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    const sender = makeSender({ status: 'sent' });
    const dispatcher = new NotificationDispatcher(store, sender);
    const result = await dispatcher.dispatch(makeInput());
    expect(result).not.toBeNull();
    expect(result!.sent).toBe(1);
  });

  it('forwards FanOutOptions to the fan-out (maxRetries)', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    // Transient failure — should retry maxRetries=0 times (only 1 attempt)
    const sender: NotificationSender = {
      send: vi.fn().mockResolvedValue({ status: 'error', retryable: true, reason: 'timeout' }),
    };
    const dispatcher = new NotificationDispatcher(store, sender);
    await dispatcher.dispatch(makeInput(), { maxRetries: 0 });
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('returns empty result counts when no devices are registered', async () => {
    const store = makeStore();
    const dispatcher = new NotificationDispatcher(store, makeSender());
    const result = await dispatcher.dispatch(makeInput());
    expect(result).toEqual({ sent: 0, skipped: 0, cleaned: 0, failed: 0 });
  });

  it('counts cleaned devices in the result', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
    });
    const sender = makeSender({ status: 'invalid_token' });
    const dispatcher = new NotificationDispatcher(store, sender);
    const result = await dispatcher.dispatch(makeInput());
    expect(result!.cleaned).toBe(1);
    expect(result!.sent).toBe(0);
  });
});

// ─── Preference awareness ─────────────────────────────────────────────────────

describe('NotificationDispatcher — preference awareness', () => {
  it('skips devices for users that have not opted in to notifications', async () => {
    const store = makeStore({
      listPage: vi.fn().mockResolvedValue({ keys: ['users/sub-a/devices/dev-1.json'] }),
      getDevice: vi.fn().mockResolvedValue(makeDevice('sub-a', 'dev-1')),
      isSubscribed: vi.fn().mockResolvedValue(false),
    });
    const sender = makeSender();
    const dispatcher = new NotificationDispatcher(store, sender);
    const result = await dispatcher.dispatch(makeInput());
    expect(sender.send).not.toHaveBeenCalled();
    expect(result!.skipped).toBe(1);
  });
});
