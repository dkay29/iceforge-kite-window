/**
 * NotificationDispatcher — idempotent, preference-aware push notification
 * dispatch for a forecast run.
 *
 * ## Idempotency and duplicate suppression
 *
 * A "sent marker" object is written to S3 after a successful fan-out:
 *   notifications/spot={spotId}/date={localDate}/run={forecastRunId}/sent.json
 *
 * Before dispatching, the dispatcher checks for the marker. If it exists, the
 * fan-out is skipped entirely. This ensures that EventBridge retries (e.g. due
 * to Lambda throttle or transient failure) do not produce duplicate pushes.
 *
 * The marker is written only after the fan-out returns. If the Lambda is killed
 * between fan-out and the marker write, at-least-once semantics apply: the
 * next invocation will re-fan-out. This is acceptable; users may receive two
 * notifications for the same window in the rare retry scenario.
 *
 * ## Preference awareness
 *
 * Subscription projection is applied inside FanOutService (issue #30): only
 * devices whose owners have notifications.enabled === true receive pushes.
 * The dispatcher does not repeat this check.
 *
 * ## Observability
 *
 * Every dispatch attempt is logged with structured fields:
 *   spotId, localDate, forecastRunId, correlationId
 *
 * After fan-out, the result counts (sent, skipped, cleaned, failed) are logged
 * and emitted as structured metrics.
 */

import type {
  FanOutMessage,
  FanOutStore,
  FanOutOptions,
  FanOutResult,
} from '../fanOut/fanOutService.js';
import { FanOutService } from '../fanOut/fanOutService.js';
import type { NotificationSender } from '../fanOut/fanOutService.js';
import { notificationSentKey } from '../s3Keys.js';
import { createLogger, recordMetric } from '../observability/logger.js';

// ─── Dispatcher store interface ───────────────────────────────────────────────

export interface DispatchStore extends FanOutStore {
  /** Return true when the sent marker key exists in S3. */
  sentMarkerExists(key: string): Promise<boolean>;
  /** Write the sent marker with the provided payload. */
  writeSentMarker(key: string, payload: SentMarker): Promise<void>;
}

// ─── Sent marker document ─────────────────────────────────────────────────────

export interface SentMarker {
  spotId: string;
  localDate: string;
  forecastRunId: string;
  sentAt: string;
  result: FanOutResult;
}

// ─── Dispatcher input ─────────────────────────────────────────────────────────

export interface DispatchInput {
  spotId: string;
  localDate: string;
  forecastRunId: string;
  message: FanOutMessage;
  correlationId?: string;
}

// ─── NotificationDispatcher ───────────────────────────────────────────────────

export class NotificationDispatcher {
  readonly #store: DispatchStore;
  readonly #sender: NotificationSender;

  constructor(store: DispatchStore, sender: NotificationSender) {
    this.#store = store;
    this.#sender = sender;
  }

  /**
   * Dispatch notifications for a forecast run.
   *
   * Returns the fan-out result, or null when the run was a duplicate (marker
   * already existed) and no pushes were sent.
   */
  async dispatch(input: DispatchInput, opts: FanOutOptions = {}): Promise<FanOutResult | null> {
    const { spotId, localDate, forecastRunId, message, correlationId = 'unknown' } = input;
    const log = createLogger({
      correlationId,
      handler: 'notificationDispatcher',
      spotId,
      forecastRunId,
    });

    const markerKey = notificationSentKey(spotId, localDate, forecastRunId);

    // Duplicate suppression — skip if already dispatched for this run
    const alreadySent = await this.#store.sentMarkerExists(markerKey);
    if (alreadySent) {
      log.info('Notification already dispatched for this run — skipping', { markerKey });
      return null;
    }

    log.info('Starting notification fan-out', { localDate });

    const fanOut = new FanOutService(this.#store, this.#sender);
    const result = await fanOut.fanOut(message, opts);

    log.info('Fan-out complete', {
      sent: result.sent,
      skipped: result.skipped,
      cleaned: result.cleaned,
      failed: result.failed,
    });

    recordMetric(log, 'forecast_served', result.sent);

    // Write idempotency marker so retries skip this run
    const marker: SentMarker = {
      spotId,
      localDate,
      forecastRunId,
      sentAt: new Date().toISOString(),
      result,
    };
    await this.#store.writeSentMarker(markerKey, marker);

    return result;
  }
}
