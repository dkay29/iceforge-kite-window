import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import type { KiteWindowEnvironment } from './environment.js';

export interface KiteWindowStackProps extends StackProps {
  /** Kite Window environment configuration (stage, prefix, removal policy, tags). */
  readonly kiteWindowEnv: KiteWindowEnvironment;
}

/**
 * Foundation stack.
 *
 * Accepts the KiteWindowEnvironment so that all child stacks and constructs
 * can produce consistently prefixed, tagged, and policy-controlled resources.
 * AWS resources are added in subsequent CDK issues (#40 onward).
 */
export class FoundationStack extends Stack {
  /** Kite Window environment available to constructs within this stack. */
  readonly kiteWindowEnv: KiteWindowEnvironment;

  constructor(scope: Construct, id: string, props: KiteWindowStackProps) {
    super(scope, id, props);
    this.kiteWindowEnv = props.kiteWindowEnv;
  }
}
