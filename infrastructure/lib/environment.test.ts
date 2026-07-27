/**
 * Tests for CDK environment configuration helpers.
 *
 * These run under Vitest (no AWS credentials required).
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { RemovalPolicy } from 'aws-cdk-lib';
import { resolveEnvironment, stageFromContext, KITE_WINDOW_REGION } from './environment.js';

// ─── resolveEnvironment ───────────────────────────────────────────────────────

describe('resolveEnvironment', () => {
  describe('dev stage', () => {
    const env = resolveEnvironment('dev');

    it('sets stage to dev', () => {
      expect(env.stage).toBe('dev');
    });

    it('uses DESTROY removal policy', () => {
      expect(env.removalPolicy).toBe(RemovalPolicy.DESTROY);
    });

    it('produces the correct stack name', () => {
      expect(env.stackName).toBe('KiteWindow-Dev');
    });

    it('produces the correct resource prefix', () => {
      expect(env.resourcePrefix).toBe('kite-window-dev');
    });

    it('applies mandatory Project tag', () => {
      expect(env.tags['Project']).toBe('iceforge-kite-window');
    });

    it('applies mandatory Environment tag', () => {
      expect(env.tags['Environment']).toBe('dev');
    });

    it('applies mandatory ManagedBy tag', () => {
      expect(env.tags['ManagedBy']).toBe('cdk');
    });
  });

  describe('prod stage', () => {
    const env = resolveEnvironment('prod');

    it('sets stage to prod', () => {
      expect(env.stage).toBe('prod');
    });

    it('uses RETAIN removal policy', () => {
      expect(env.removalPolicy).toBe(RemovalPolicy.RETAIN);
    });

    it('produces the correct stack name', () => {
      expect(env.stackName).toBe('KiteWindow-Prod');
    });

    it('produces the correct resource prefix', () => {
      expect(env.resourcePrefix).toBe('kite-window-prod');
    });

    it('applies mandatory Environment tag', () => {
      expect(env.tags['Environment']).toBe('prod');
    });
  });

  describe('region resolution', () => {
    const originalRegion = process.env['CDK_DEFAULT_REGION'];

    afterEach(() => {
      if (originalRegion === undefined) {
        delete process.env['CDK_DEFAULT_REGION'];
      } else {
        process.env['CDK_DEFAULT_REGION'] = originalRegion;
      }
    });

    it('defaults to KITE_WINDOW_REGION when CDK_DEFAULT_REGION is not set', () => {
      delete process.env['CDK_DEFAULT_REGION'];
      const env = resolveEnvironment('dev');
      expect(env.awsEnv.region).toBe(KITE_WINDOW_REGION);
    });

    it('uses CDK_DEFAULT_REGION when set', () => {
      process.env['CDK_DEFAULT_REGION'] = 'eu-west-1';
      const env = resolveEnvironment('dev');
      expect(env.awsEnv.region).toBe('eu-west-1');
    });
  });

  describe('account resolution', () => {
    const originalAccount = process.env['CDK_DEFAULT_ACCOUNT'];

    beforeEach(() => {
      delete process.env['CDK_DEFAULT_ACCOUNT'];
    });

    afterEach(() => {
      if (originalAccount === undefined) {
        delete process.env['CDK_DEFAULT_ACCOUNT'];
      } else {
        process.env['CDK_DEFAULT_ACCOUNT'] = originalAccount;
      }
    });

    it('leaves account undefined when CDK_DEFAULT_ACCOUNT is not set', () => {
      const env = resolveEnvironment('dev');
      expect(env.awsEnv.account).toBeUndefined();
    });

    it('passes CDK_DEFAULT_ACCOUNT when set', () => {
      process.env['CDK_DEFAULT_ACCOUNT'] = '123456789012';
      const env = resolveEnvironment('dev');
      expect(env.awsEnv.account).toBe('123456789012');
    });
  });
});

// ─── stageFromContext ─────────────────────────────────────────────────────────

describe('stageFromContext', () => {
  it('returns prod when context value is "prod"', () => {
    expect(stageFromContext({ tryGetContext: () => 'prod' })).toBe('prod');
  });

  it('returns dev when context value is absent (undefined)', () => {
    expect(stageFromContext({ tryGetContext: () => undefined })).toBe('dev');
  });

  it('returns dev when context value is an unexpected string', () => {
    expect(stageFromContext({ tryGetContext: () => 'staging' })).toBe('dev');
  });

  it('returns dev when context value is null', () => {
    expect(stageFromContext({ tryGetContext: () => null })).toBe('dev');
  });

  it('returns dev when context key is missing (returns empty string)', () => {
    expect(stageFromContext({ tryGetContext: () => '' })).toBe('dev');
  });
});

// ─── KITE_WINDOW_REGION ───────────────────────────────────────────────────────

describe('KITE_WINDOW_REGION', () => {
  it('is us-east-1', () => {
    expect(KITE_WINDOW_REGION).toBe('us-east-1');
  });
});
