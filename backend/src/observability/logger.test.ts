import { describe, expect, it, vi } from 'vitest';
import { createLogger, recordMetric } from './logger.js';
import type { LogContext } from './logger.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSink(): { lines: LogContext[]; fn: (s: string) => void } {
  const lines: LogContext[] = [];
  return {
    lines,
    fn: (s: string) => lines.push(JSON.parse(s) as LogContext),
  };
}

// ─── Basic logging ────────────────────────────────────────────────────────────

describe('createLogger — log levels', () => {
  it('info() emits a record with level=info', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({}, fn);
    log.info('hello');
    expect(lines[0]!['level']).toBe('info');
    expect(lines[0]!['message']).toBe('hello');
  });

  it('debug() emits level=debug', () => {
    const { lines, fn } = makeSink();
    createLogger({}, fn).debug('dbg');
    expect(lines[0]!['level']).toBe('debug');
  });

  it('warn() emits level=warn', () => {
    const { lines, fn } = makeSink();
    createLogger({}, fn).warn('oops');
    expect(lines[0]!['level']).toBe('warn');
  });

  it('error() emits level=error', () => {
    const { lines, fn } = makeSink();
    createLogger({}, fn).error('fail');
    expect(lines[0]!['level']).toBe('error');
  });
});

describe('createLogger — timestamp', () => {
  it('every record includes a valid ISO 8601 UTC timestamp', () => {
    const { lines, fn } = makeSink();
    const before = Date.now();
    createLogger({}, fn).info('ts test');
    const after = Date.now();
    const ts = new Date(lines[0]!['timestamp'] as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe('createLogger — base context', () => {
  it('base context fields are included in every record', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({ correlationId: 'abc-123', spotId: 'west-dennis' }, fn);
    log.info('test');
    expect(lines[0]!['correlationId']).toBe('abc-123');
    expect(lines[0]!['spotId']).toBe('west-dennis');
  });

  it('per-call context merges with base context', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({ correlationId: 'abc' }, fn);
    log.info('event', { localDate: '2026-07-26' });
    expect(lines[0]!['correlationId']).toBe('abc');
    expect(lines[0]!['localDate']).toBe('2026-07-26');
  });

  it('per-call context overrides base context on collision', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({ spotId: 'base-spot' }, fn);
    log.info('override', { spotId: 'override-spot' });
    expect(lines[0]!['spotId']).toBe('override-spot');
  });

  it('records without extra context still include base context', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({ correlationId: 'xyz' }, fn);
    log.warn('bare message');
    expect(lines[0]!['correlationId']).toBe('xyz');
  });
});

describe('createLogger — child loggers', () => {
  it('child logger inherits parent context', () => {
    const { lines, fn } = makeSink();
    const parent = createLogger({ correlationId: 'parent-id' }, fn);
    const child = parent.child({ spotId: 'west-dennis' });
    child.info('child message');
    expect(lines[0]!['correlationId']).toBe('parent-id');
    expect(lines[0]!['spotId']).toBe('west-dennis');
  });

  it('child context overrides parent context on collision', () => {
    const { lines, fn } = makeSink();
    const parent = createLogger({ spotId: 'parent-spot', correlationId: 'abc' }, fn);
    const child = parent.child({ spotId: 'child-spot' });
    child.info('test');
    expect(lines[0]!['spotId']).toBe('child-spot');
    expect(lines[0]!['correlationId']).toBe('abc');
  });

  it('grandchild logger inherits all ancestor context', () => {
    const { lines, fn } = makeSink();
    const grandchild = createLogger({ a: 1 }, fn).child({ b: 2 }).child({ c: 3 });
    grandchild.info('deep');
    expect(lines[0]!['a']).toBe(1);
    expect(lines[0]!['b']).toBe(2);
    expect(lines[0]!['c']).toBe(3);
  });

  it('parent logger is unaffected by child context', () => {
    const { lines, fn } = makeSink();
    const parent = createLogger({ correlationId: 'abc' }, fn);
    parent.child({ spotId: 'child' });
    parent.info('parent msg');
    expect(lines[0]!['spotId']).toBeUndefined();
  });
});

describe('createLogger — output format', () => {
  it('emits valid JSON', () => {
    const records: string[] = [];
    const log = createLogger({}, (s) => records.push(s));
    log.info('json test', { num: 42, bool: true });
    expect(() => JSON.parse(records[0]!)).not.toThrow();
  });

  it('each log() call emits exactly one record', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({}, fn);
    log.info('a');
    log.warn('b');
    log.error('c');
    expect(lines).toHaveLength(3);
  });
});

describe('createLogger — default sink', () => {
  it('uses console.log by default (no throw)', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const log = createLogger({ correlationId: 'test' });
      log.info('default sink test');
      expect(consoleSpy).toHaveBeenCalledOnce();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

// ─── recordMetric ─────────────────────────────────────────────────────────────

describe('recordMetric', () => {
  it('emits a record with type=METRIC', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({}, fn);
    recordMetric(log, 'forecast_served', 1);
    expect(lines[0]!['type']).toBe('METRIC');
  });

  it('emits the metric name and value', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({}, fn);
    recordMetric(log, 'pipeline_duration_ms', 1234);
    expect(lines[0]!['metricName']).toBe('pipeline_duration_ms');
    expect(lines[0]!['metricValue']).toBe(1234);
  });

  it('merges additional context into the metric record', () => {
    const { lines, fn } = makeSink();
    const log = createLogger({ correlationId: 'abc' }, fn);
    recordMetric(log, 'refresh_success', 1, { spotId: 'west-dennis' });
    expect(lines[0]!['correlationId']).toBe('abc');
    expect(lines[0]!['spotId']).toBe('west-dennis');
  });

  it('all valid MetricName values are accepted', () => {
    const { fn } = makeSink();
    const log = createLogger({}, fn);
    // Should not throw for any valid metric name
    expect(() => {
      recordMetric(log, 'refresh_success', 1);
      recordMetric(log, 'refresh_failure', 1);
      recordMetric(log, 'forecast_served', 1);
      recordMetric(log, 'forecast_cache_hit', 1);
      recordMetric(log, 'source_freshness_lag_seconds', 3600);
      recordMetric(log, 'pipeline_duration_ms', 800);
    }).not.toThrow();
  });
});
