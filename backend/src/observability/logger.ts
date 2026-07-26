/**
 * Structured JSON logger for Lambda and pipeline execution.
 *
 * Outputs one JSON object per line to stdout.  Each log record includes:
 *   - timestamp     ISO 8601 UTC
 *   - level         debug | info | warn | error
 *   - correlationId propagated through the request lifecycle
 *   - message       human-readable description
 *   - context       arbitrary structured fields
 *
 * Usage:
 *   const log = createLogger({ correlationId: event.requestContext.requestId });
 *   log.info('Forecast served', { spotId, localDate });
 *
 *   const childLog = log.child({ spotId, localDate });
 *   childLog.warn('Stale data detected', { ageMs: 7200_000 });
 *
 * Child loggers inherit the parent's context fields and merge with their own.
 *
 * Metric records (recordMetric) are ordinary log lines with type='METRIC' so
 * that CloudWatch Logs Insights metric filters can extract them:
 *   fields @timestamp, metricName, metricValue
 *   filter type = 'METRIC'
 *   stats avg(metricValue) by metricName
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Arbitrary structured key-value pairs attached to a log record. */
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /**
   * Create a child logger that merges the given context with the parent's
   * context.  Child context fields override parent fields on collision.
   */
  child(context: LogContext): Logger;
}

// ─── Metric types ─────────────────────────────────────────────────────────────

/**
 * Named metrics emitted as structured log records.
 *
 * These can be parsed by CloudWatch Logs Insights metric filters or
 * CloudWatch EMF consumers.
 */
export type MetricName =
  | 'refresh_success'
  | 'refresh_failure'
  | 'forecast_served'
  | 'forecast_cache_hit'
  | 'source_freshness_lag_seconds'
  | 'pipeline_duration_ms';

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a structured logger with an optional base context.
 *
 * @param baseContext - Fields included in every log record (e.g. correlationId).
 * @param sink        - Output function; defaults to console.log for Lambda stdout.
 */
export function createLogger(
  baseContext: LogContext = {},
  sink: (record: string) => void = console.log,
): Logger {
  return makeLogger(baseContext, sink);
}

// ─── Implementation ───────────────────────────────────────────────────────────

function makeLogger(context: LogContext, sink: (record: string) => void): Logger {
  function emit(level: LogLevel, message: string, extra?: LogContext): void {
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
      ...extra,
    };
    sink(JSON.stringify(record));
  }

  return {
    debug: (msg, ctx?) => emit('debug', msg, ctx),
    info: (msg, ctx?) => emit('info', msg, ctx),
    warn: (msg, ctx?) => emit('warn', msg, ctx),
    error: (msg, ctx?) => emit('error', msg, ctx),
    child: (childContext) => makeLogger({ ...context, ...childContext }, sink),
  };
}

// ─── Metric helper ────────────────────────────────────────────────────────────

/**
 * Emit a metric record as a structured log line.
 *
 * The record has `type: 'METRIC'` to enable CloudWatch Logs Insights filtering:
 *   filter type = 'METRIC' | stats avg(metricValue) by metricName, bin(5m)
 */
export function recordMetric(
  logger: Logger,
  name: MetricName,
  value: number,
  context?: LogContext,
): void {
  logger.info(`Metric: ${name}`, {
    type: 'METRIC',
    metricName: name,
    metricValue: value,
    ...context,
  });
}
