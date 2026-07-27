/**
 * PushSender — implements NotificationSender using AWS End User Messaging Push.
 *
 * AWS End User Messaging Push is the successor to Amazon Pinpoint for mobile
 * push. Tokens are sent directly without pre-registering platform endpoints;
 * the service accepts APNs device tokens and FCM registration tokens natively.
 *
 * This module isolates all AWS SDK coupling behind the AwsPushClient interface
 * so that unit tests never require live AWS credentials.
 *
 * ## APNs token errors
 *   - HTTP 410 Gone or BadDeviceToken payload → invalid_token
 *   - HTTP 4xx non-410 → non-retryable error
 *   - HTTP 5xx → retryable error
 *
 * ## FCM token errors
 *   - UNREGISTERED / INVALID_REGISTRATION → invalid_token
 *   - SERVER_UNAVAILABLE / QUOTA_EXCEEDED → retryable error
 *   - Other 4xx error codes → non-retryable error
 */

import type { FanOutMessage, NotificationSender, SendResult } from '../fanOut/fanOutService.js';
import type { DeviceRegistration } from '../generated/schema-types.js';

// ─── AWS Push client interface ────────────────────────────────────────────────

/**
 * Outcome returned by the push provider for a single message.
 */
export type PushOutcome =
  | { status: 'delivered' }
  | { status: 'invalid_token'; reason: string }
  | { status: 'transient_error'; reason: string }
  | { status: 'permanent_error'; reason: string };

/**
 * Thin interface over AWS End User Messaging Push (or any push provider).
 * The concrete implementation wraps the AWS SDK and is injected at Lambda
 * startup. Tests inject a stub.
 */
export interface AwsPushClient {
  /**
   * Send a push notification to a single device.
   *
   * @param platform  'apns' or 'fcm'
   * @param token     Device token or FCM registration token
   * @param title     Notification title
   * @param body      Notification body
   * @param data      Optional key-value data payload
   */
  sendPush(
    platform: DeviceRegistration['platform'],
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<PushOutcome>;
}

// ─── PushSender ───────────────────────────────────────────────────────────────

/**
 * Adapts AwsPushClient to the NotificationSender interface expected by
 * FanOutService. Maps push provider outcomes to the three-value SendResult.
 */
export class PushSender implements NotificationSender {
  readonly #client: AwsPushClient;

  constructor(client: AwsPushClient) {
    this.#client = client;
  }

  async send(
    platform: DeviceRegistration['platform'],
    token: string,
    message: FanOutMessage,
  ): Promise<SendResult> {
    const outcome = await this.#client.sendPush(
      platform,
      token,
      message.title,
      message.body,
      message.data,
    );

    switch (outcome.status) {
      case 'delivered':
        return { status: 'sent' };
      case 'invalid_token':
        return { status: 'invalid_token' };
      case 'transient_error':
        return { status: 'error', retryable: true, reason: outcome.reason };
      case 'permanent_error':
        return { status: 'error', retryable: false, reason: outcome.reason };
    }
  }
}
