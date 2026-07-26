import { describe, expect, it } from 'vitest';
import {
  generateCorrelationId,
  extractCorrelationId,
  resolveCorrelationId,
  CORRELATION_ID_HEADER,
} from './correlationId.js';

describe('generateCorrelationId', () => {
  it('returns a non-empty string', () => {
    expect(generateCorrelationId()).toBeTruthy();
    expect(typeof generateCorrelationId()).toBe('string');
  });

  it('returns a RFC 4122 v4 UUID', () => {
    const uuid = generateCorrelationId();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('each call produces a unique ID', () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateCorrelationId()));
    expect(ids.size).toBe(10);
  });
});

describe('extractCorrelationId', () => {
  it('returns the x-correlation-id header value when present', () => {
    const headers = { [CORRELATION_ID_HEADER]: 'my-id-123' };
    expect(extractCorrelationId(headers)).toBe('my-id-123');
  });

  it('returns undefined when the header is absent', () => {
    expect(extractCorrelationId({})).toBeUndefined();
  });

  it('returns undefined for undefined headers object', () => {
    expect(extractCorrelationId(undefined)).toBeUndefined();
  });

  it('is case-sensitive to lowercase header name (API Gateway v2 convention)', () => {
    // API Gateway v2 lowercases all headers; uppercase version is not found
    const headers = { 'X-Correlation-Id': 'mixed-case' };
    expect(extractCorrelationId(headers)).toBeUndefined();
  });
});

describe('resolveCorrelationId', () => {
  it('prefers the client-supplied header over requestId', () => {
    const headers = { [CORRELATION_ID_HEADER]: 'client-id' };
    expect(resolveCorrelationId(headers, 'api-gw-request-id')).toBe('client-id');
  });

  it('falls back to requestId when header is absent', () => {
    expect(resolveCorrelationId({}, 'api-gw-request-id')).toBe('api-gw-request-id');
  });

  it('generates a UUID when both header and requestId are absent', () => {
    const id = resolveCorrelationId({}, undefined);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('generates a UUID when headers is undefined', () => {
    const id = resolveCorrelationId(undefined, undefined);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('CORRELATION_ID_HEADER', () => {
  it('is lowercase', () => {
    expect(CORRELATION_ID_HEADER).toBe(CORRELATION_ID_HEADER.toLowerCase());
  });

  it('is the expected header name', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });
});
