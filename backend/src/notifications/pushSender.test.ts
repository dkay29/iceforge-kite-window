/**
 * Tests for PushSender — adapts AwsPushClient outcomes to SendResult.
 */

import { describe, it, expect, vi } from 'vitest';
import { PushSender, type AwsPushClient } from './pushSender.js';

function makeClient(outcome: Awaited<ReturnType<AwsPushClient['sendPush']>>): AwsPushClient {
  return { sendPush: vi.fn().mockResolvedValue(outcome) };
}

describe('PushSender', () => {
  it('maps "delivered" to { status: "sent" }', async () => {
    const sender = new PushSender(makeClient({ status: 'delivered' }));
    const result = await sender.send('apns', 'tok', { title: 'T', body: 'B' });
    expect(result.status).toBe('sent');
  });

  it('maps "invalid_token" to { status: "invalid_token" }', async () => {
    const sender = new PushSender(
      makeClient({ status: 'invalid_token', reason: 'BadDeviceToken' }),
    );
    const result = await sender.send('apns', 'tok', { title: 'T', body: 'B' });
    expect(result.status).toBe('invalid_token');
  });

  it('maps "transient_error" to retryable error', async () => {
    const sender = new PushSender(makeClient({ status: 'transient_error', reason: '5xx' }));
    const result = await sender.send('fcm', 'tok', { title: 'T', body: 'B' });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.retryable).toBe(true);
  });

  it('maps "permanent_error" to non-retryable error', async () => {
    const sender = new PushSender(
      makeClient({ status: 'permanent_error', reason: 'UNREGISTERED' }),
    );
    const result = await sender.send('fcm', 'tok', { title: 'T', body: 'B' });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.retryable).toBe(false);
  });

  it('passes platform, token, and message fields to the client', async () => {
    const client = makeClient({ status: 'delivered' });
    const sender = new PushSender(client);
    await sender.send('apns', 'my-token', {
      title: 'Go!',
      body: 'Window open',
      data: { spotId: 'x' },
    });
    expect(client.sendPush).toHaveBeenCalledWith('apns', 'my-token', 'Go!', 'Window open', {
      spotId: 'x',
    });
  });
});
