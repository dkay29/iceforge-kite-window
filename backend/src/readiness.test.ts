import { describe, expect, it } from 'vitest';
import { getReadinessStatus } from './readiness.js';

describe('getReadinessStatus', () => {
  it('reports the backend workspace as ready', () => {
    expect(getReadinessStatus()).toBe('ready');
  });
});
