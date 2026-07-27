#!/usr/bin/env node
/**
 * Kite Window CDK application entry point.
 *
 * Stage is supplied via CDK context:
 *   cdk synth -c stage=dev    (default when context is absent)
 *   cdk synth -c stage=prod
 *
 * Local synth requires no AWS credentials.
 * Deployment requires an explicit AWS profile:
 *   cdk deploy --profile kite-window-dev
 *   cdk deploy --profile kite-window-prod
 */
import { App, Tags } from 'aws-cdk-lib';
import { FoundationStack } from '../lib/foundation-stack.js';
import { resolveEnvironment, stageFromContext } from '../lib/environment.js';

const app = new App();

const stage = stageFromContext(app.node);
const env = resolveEnvironment(stage);

// Apply mandatory tags to every resource synthesised in this app.
for (const [key, value] of Object.entries(env.tags)) {
  Tags.of(app).add(key, value);
}

new FoundationStack(app, env.stackName, {
  env: env.awsEnv,
  kiteWindowEnv: env,
});
