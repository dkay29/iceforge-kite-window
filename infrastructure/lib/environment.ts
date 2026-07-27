/**
 * Kite Window CDK environment configuration.
 *
 * Defines the naming, tagging, and removal-policy conventions shared by every
 * stack in the project.  All stacks receive a KiteWindowEnvironment so they
 * can produce consistent resource names without hard-coding stage strings.
 *
 * ## Passing the stage
 *
 * Supply the stage via CDK context at synth time:
 *
 *   cdk synth -c stage=dev   # default when no context is provided
 *   cdk synth -c stage=prod
 *
 * ## Credentials
 *
 * Local synth requires no AWS credentials.  Account resolves from
 * CDK_DEFAULT_ACCOUNT when credentials are present (e.g. during a real
 * deployment); region defaults to KITE_WINDOW_REGION when CDK_DEFAULT_REGION
 * is not set.
 *
 * ## Deployment
 *
 * Deployment requires an explicit AWS profile or CI role:
 *
 *   cdk deploy --profile kite-window-dev
 *   cdk deploy --profile kite-window-prod
 *
 * The CI/CD role is assumed via OIDC — no long-lived access keys are stored.
 */

import { RemovalPolicy } from 'aws-cdk-lib';
import type { Environment } from 'aws-cdk-lib';

// ─── Stage ───────────────────────────────────────────────────────────────────

/** Supported deployment stages. */
export type KiteWindowStage = 'dev' | 'prod';

// ─── Primary region ───────────────────────────────────────────────────────────

/**
 * Primary AWS region for all Kite Window resources.
 *
 * us-east-1 is selected because:
 * - NWS and NOAA APIs are US-hosted; latency from us-east-1 is minimal.
 * - CloudFront, ACM, and API Gateway have strong us-east-1 footprints.
 * - Initial user base is US East Coast.
 */
export const KITE_WINDOW_REGION = 'us-east-1';

// ─── Environment shape ────────────────────────────────────────────────────────

export interface KiteWindowEnvironment {
  /** Deployment stage. */
  readonly stage: KiteWindowStage;

  /**
   * CDK environment (account + region).
   * account is undefined for environment-agnostic local synth.
   */
  readonly awsEnv: Environment;

  /**
   * CloudFormation stack name.
   * Convention: KiteWindow-<Stage>  (e.g. KiteWindow-Dev, KiteWindow-Prod)
   */
  readonly stackName: string;

  /**
   * Prefix prepended to every named AWS resource.
   * Convention: kite-window-<stage>  (e.g. kite-window-dev, kite-window-prod)
   * Use this prefix for S3 bucket names, Lambda names, log groups, etc.
   */
  readonly resourcePrefix: string;

  /**
   * Mandatory tags applied to every resource in this environment.
   * All stacks call Tags.of(app).add() with these before synthesis.
   */
  readonly tags: Readonly<Record<string, string>>;

  /**
   * Removal policy for stateful resources (S3 buckets, log groups, etc.).
   * - dev:  DESTROY — allow teardown without manual intervention.
   * - prod: RETAIN  — protect data from accidental stack deletion.
   */
  readonly removalPolicy: RemovalPolicy;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build the KiteWindowEnvironment for a given stage.
 *
 * Account is resolved from CDK_DEFAULT_ACCOUNT when credentials are available;
 * it is left undefined for credential-free local synth (environment-agnostic
 * stacks).  Region falls back to KITE_WINDOW_REGION when CDK_DEFAULT_REGION
 * is not set.
 */
export function resolveEnvironment(stage: KiteWindowStage): KiteWindowEnvironment {
  const capitalisedStage = stage.charAt(0).toUpperCase() + stage.slice(1);

  return {
    stage,
    awsEnv: {
      ...(process.env['CDK_DEFAULT_ACCOUNT'] !== undefined && {
        account: process.env['CDK_DEFAULT_ACCOUNT'],
      }),
      region: process.env['CDK_DEFAULT_REGION'] ?? KITE_WINDOW_REGION,
    },
    stackName: `KiteWindow-${capitalisedStage}`,
    resourcePrefix: `kite-window-${stage}`,
    tags: {
      Project: 'iceforge-kite-window',
      Environment: stage,
      ManagedBy: 'cdk',
      Owner: 'iceforge',
    },
    removalPolicy: stage === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  };
}

// ─── Context helper ───────────────────────────────────────────────────────────

/**
 * Read the deployment stage from CDK context.
 *
 * Returns 'prod' only when the context value is exactly the string 'prod'.
 * All other values — including absent context — yield 'dev', making dev the
 * safe default for local synth and CI dry-runs.
 */
export function stageFromContext(node: { tryGetContext(key: string): unknown }): KiteWindowStage {
  return node.tryGetContext('stage') === 'prod' ? 'prod' : 'dev';
}
