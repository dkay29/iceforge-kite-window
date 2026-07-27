/**
 * S3-based notification fan-out service.
 *
 * ## Strategy
 *
 * Device registrations are stored as individual S3 objects:
 *   users/{cognitoSub}/devices/{deviceId}.json
 *
 * User notification opt-in is stored in preferences:
 *   users/{cognitoSub}/preferences.json  (notifications.enabled)
 *
 * Fan-out enumerates all device keys under the `users/` prefix using paginated
 * S3 ListObjectsV2 calls (up to 1000 keys per page). For each device it reads
 * the owner's preferences to apply the subscription projection. Devices for
 * opted-out users are skipped without incurring a push API call.
 *
 * ## Subscription projection
 *
 * A device is included in a fan-out run when:
 *   1. Its owner's preferences.notifications.enabled === true.
 *   2. The device registration record is present and valid.
 *
 * ## Scale limits
 *
 * - S3 ListObjectsV2 returns at most 1000 keys per call; the service uses
 *   continuation tokens to exhaust all pages.
 * - With U users each owning D devices, the prefix `users/` produces
 *   U * (1 + D) objects (preferences + devices). For example, 5 000 users
 *   each with 1 device = 10 000 objects = 10 paginated list calls.
 * - Preferences are fetched per-user and not cached across fan-out runs.
 *   At large scale a denormalised subscription index would be more efficient;
 *   this implementation is correct for MVP volumes (< 10 000 users).
 *
 * ## Retries
 *
 * Transient send failures (e.g. provider 5xx) are retried up to `maxRetries`
 * times (default 2) with no delay. Non-retryable failures are logged and skipped.
 *
 * ## Invalid token handling
 *
 * When the push provider reports that a device token is invalid or expired, the
 * device registration is immediately deleted from S3 so that future fan-out runs
 * do not attempt delivery to that token again. The deletion is fire-and-forget
 * within the fan-out attempt; a failure to delete is logged but does not fail
 * the overall run.
 */

import type { DeviceRegistration } from '../generated/schema-types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FanOutMessage {
  /** Notification title shown in the system tray. */
  title: string;
  /** Notification body text. */
  body: string;
  /** Optional key-value pairs included in the push payload. */
  data?: Record<string, string>;
}

export type SendResult =
  | { status: 'sent' }
  | { status: 'invalid_token' }
  | { status: 'error'; retryable: boolean; reason: string };

export interface NotificationSender {
  send(
    platform: DeviceRegistration['platform'],
    token: string,
    message: FanOutMessage,
  ): Promise<SendResult>;
}

export interface ListPage {
  /** S3 object keys returned for this page. */
  keys: string[];
  /** Pass to the next list call to continue pagination; undefined on the last page. */
  nextToken?: string;
}

export interface FanOutStore {
  /**
   * List S3 object keys under `prefix`.
   * @param prefix  Key prefix (e.g. 'users/').
   * @param continuationToken  Token from a prior page; undefined for the first page.
   * @returns Up to 1000 keys and an optional continuation token.
   */
  listPage(prefix: string, continuationToken?: string): Promise<ListPage>;

  /**
   * Retrieve a device registration, or null when the key does not exist or
   * the stored value does not match the expected shape.
   */
  getDevice(key: string): Promise<DeviceRegistration | null>;

  /**
   * Return true when the user identified by cognitoSub has notifications enabled
   * in their preferences. Returns false when preferences are absent or the flag
   * is not set.
   */
  isSubscribed(cognitoSub: string): Promise<boolean>;

  /**
   * Delete the device registration at `key`. Silently succeeds when absent.
   */
  deleteDevice(key: string): Promise<void>;
}

export interface FanOutOptions {
  /** Maximum number of times to retry a transient send failure. Default: 2. */
  maxRetries?: number;
}

export interface FanOutResult {
  /** Number of notifications successfully sent. */
  sent: number;
  /** Number of devices skipped (opted-out or bad record). */
  skipped: number;
  /** Number of device registrations cleaned up due to invalid token. */
  cleaned: number;
  /** Number of send failures that were not recoverable. */
  failed: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

const DEVICE_KEY_PATTERN = /^users\/[^/]+\/devices\/[^/]+\.json$/;
const USER_SUB_FROM_DEVICE_KEY = /^users\/([^/]+)\/devices\//;

export class FanOutService {
  readonly #store: FanOutStore;
  readonly #sender: NotificationSender;

  constructor(store: FanOutStore, sender: NotificationSender) {
    this.#store = store;
    this.#sender = sender;
  }

  /**
   * Fan out `message` to all opted-in devices.
   *
   * Paginates through every device key under `users/`, applies the subscription
   * projection, retries transient failures, and cleans up invalid tokens.
   */
  async fanOut(message: FanOutMessage, opts: FanOutOptions = {}): Promise<FanOutResult> {
    const maxRetries = opts.maxRetries ?? 2;
    const result: FanOutResult = { sent: 0, skipped: 0, cleaned: 0, failed: 0 };

    let continuationToken: string | undefined;
    do {
      const page = await this.#store.listPage('users/', continuationToken);
      continuationToken = page.nextToken;

      for (const key of page.keys) {
        if (!DEVICE_KEY_PATTERN.test(key)) continue;

        const subMatch = USER_SUB_FROM_DEVICE_KEY.exec(key);
        const cognitoSub = subMatch?.[1];
        if (!cognitoSub) {
          result.skipped++;
          continue;
        }

        // Subscription projection — skip users that have not opted in
        const subscribed = await this.#store.isSubscribed(cognitoSub);
        if (!subscribed) {
          result.skipped++;
          continue;
        }

        const device = await this.#store.getDevice(key);
        if (device === null) {
          result.skipped++;
          continue;
        }

        const sendResult = await this.#sendWithRetry(device, message, maxRetries);

        if (sendResult.status === 'sent') {
          result.sent++;
        } else if (sendResult.status === 'invalid_token') {
          // Invalid token cleanup — remove so future runs skip this device
          try {
            await this.#store.deleteDevice(key);
          } catch {
            // Deletion failure is non-fatal; will retry on the next fan-out run
          }
          result.cleaned++;
        } else {
          result.failed++;
        }
      }
    } while (continuationToken !== undefined);

    return result;
  }

  async #sendWithRetry(
    device: DeviceRegistration,
    message: FanOutMessage,
    maxRetries: number,
  ): Promise<SendResult> {
    let attempt = 0;
    let lastResult: SendResult = { status: 'error', retryable: false, reason: 'never attempted' };

    while (attempt <= maxRetries) {
      const res = await this.#sender.send(device.platform, device.token, message);
      if (res.status === 'sent' || res.status === 'invalid_token') return res;
      if (!res.retryable) return res;
      lastResult = res;
      attempt++;
    }

    return lastResult;
  }
}
