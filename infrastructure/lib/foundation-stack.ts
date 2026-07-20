import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

/**
 * Placeholder stack that proves `cdk synth` is wired correctly.
 * Real resources are added by the AWS CDK foundation issue.
 */
export class FoundationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
  }
}
