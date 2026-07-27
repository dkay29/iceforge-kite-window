# AWS Environment and Deployment Contract

Defines how Kite Window AWS environments are named, configured, synthesised,
deployed, protected, and cost-controlled.

---

## Environments

| Stage  | Purpose                                         | Removal policy                                       |
| ------ | ----------------------------------------------- | ---------------------------------------------------- |
| `dev`  | Local development, feature testing, CI dry-runs | DESTROY — resources may be deleted at will           |
| `prod` | Live service serving real users                 | RETAIN — stateful resources are never deleted by CDK |

`dev` is the default. All local and CI synth runs use `dev` unless `stage=prod`
is explicitly passed via CDK context.

---

## AWS region

**Primary region: `us-east-1`**

Selection rationale:

- NWS and NOAA CO-OPS APIs are hosted on US infrastructure; round-trip
  latency from `us-east-1` is minimal.
- Initial user base is US East Coast (Cape Cod, Massachusetts).
- API Gateway, CloudFront, ACM, and EventBridge have strong `us-east-1`
  footprints and consistent feature availability.

The region constant is `KITE_WINDOW_REGION` in
`infrastructure/lib/environment.ts`. It is the default when `CDK_DEFAULT_REGION`
is not set.

---

## Stack naming

| Stage | Stack name        |
| ----- | ----------------- |
| dev   | `KiteWindow-Dev`  |
| prod  | `KiteWindow-Prod` |

Stack names are constructed by `resolveEnvironment()` and passed to the CDK
`App` as the stack identifier. They must not be changed after the first
deployment to a given stage because CloudFormation treats a stack rename as
deletion + creation.

---

## Resource-name prefix

Every named AWS resource (S3 buckets, Lambda functions, log groups, IAM roles,
etc.) is prefixed with:

| Stage | Prefix             |
| ----- | ------------------ |
| dev   | `kite-window-dev`  |
| prod  | `kite-window-prod` |

**Example bucket names:**

```
kite-window-dev-data
kite-window-prod-data
```

Prefixes are available at `kiteWindowEnv.resourcePrefix` inside every CDK
construct.

---

## Mandatory resource tags

All resources in every environment receive the following tags, applied at the
CDK App level so they cascade to every synthesised resource:

| Tag key       | Value                  |
| ------------- | ---------------------- |
| `Project`     | `iceforge-kite-window` |
| `Environment` | `dev` or `prod`        |
| `ManagedBy`   | `cdk`                  |
| `Owner`       | `iceforge`             |

Tags support cost allocation reports, ownership queries, and compliance
auditing.

---

## Account and region configuration

Account and region are **never hard-coded** in application logic. They are
resolved at synth or deploy time:

| Variable              | Source                                           | Used for                  |
| --------------------- | ------------------------------------------------ | ------------------------- |
| `CDK_DEFAULT_ACCOUNT` | Set by `cdk deploy` when credentials are present | Stack environment binding |
| `CDK_DEFAULT_REGION`  | Set by `cdk deploy` when credentials are present | Region override           |

When neither variable is set (local synth without credentials), CDK synthesises
**environment-agnostic** stacks. Agnostic stacks do not embed account or region
tokens in the CloudFormation template, which is the correct behaviour for local
development and CI validation.

---

## Removal policies

| Stage  | Policy    | Effect                                                                                                                       |
| ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `dev`  | `DESTROY` | CDK may delete the resource when the stack is removed. Safe for ephemeral development environments.                          |
| `prod` | `RETAIN`  | CDK removes the resource from the stack but does NOT delete it from AWS. Prevents accidental data loss during stack updates. |

Every stateful construct (S3 buckets, CloudWatch log groups, DLQs, etc.) must
use `kiteWindowEnv.removalPolicy`. Do not hard-code removal policies inside
constructs.

---

## Deployment requirements

### Local synth (no credentials required)

```bash
# Default: dev stage
npm run synth

# Explicit dev
npm run synth -- -c stage=dev

# Prod (produces prod CloudFormation template; no deployment occurs)
npm run synth -- -c stage=prod
```

### Deployment (credentials required)

Deployment requires an explicit named profile that assumes the appropriate IAM
role for the target environment. Long-lived access keys must not be used.

```bash
# Deploy dev
cdk deploy --profile kite-window-dev -c stage=dev

# Deploy prod (requires approval prompt)
cdk deploy --profile kite-window-prod -c stage=prod
```

### CI/CD

CI deployments assume an IAM role via GitHub Actions OIDC federation. The
role ARN is stored as a GitHub Actions secret (`AWS_ROLE_ARN_DEV`,
`AWS_ROLE_ARN_PROD`). No long-lived access keys are stored in CI.

Example step (not yet wired — added when CI deployment is configured):

```yaml
- uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: ${{ secrets.AWS_ROLE_ARN_PROD }}
    aws-region: us-east-1
```

---

## Expected monthly cost drivers

| Service                     | Expected usage                                       | Estimated cost driver                  |
| --------------------------- | ---------------------------------------------------- | -------------------------------------- |
| S3                          | ~100 MB stored; ~500 GET requests/day                | Negligible (<$0.01/month)              |
| Lambda                      | Pipeline: hourly invocations ~5 s; API: ~100 req/day | Free tier covers initial usage         |
| API Gateway                 | ~100 req/day                                         | Free tier (1 M req/month free)         |
| EventBridge Scheduler       | 1 schedule, hourly                                   | Free tier (1 M invocations/month free) |
| CloudWatch Logs             | ~1 GB/month ingestion                                | ~$0.50/month                           |
| CloudWatch Alarms           | ~10 alarms                                           | ~$1.00/month                           |
| Cognito                     | <1,000 MAU                                           | Free tier                              |
| AWS End User Messaging Push | <1,000 notifications/month                           | Free tier                              |

**Estimated total (MVP, dev + prod): < $5/month**

Cost grows linearly with spots and active users. There are no fixed
reservation costs or minimum commitments at the MVP scale.

### Cost controls

- S3 lifecycle rules expire raw provider data after 30 days.
- Lambda concurrency limits are set per function to prevent runaway cost from
  accidental loops.
- CloudWatch log retention is capped (7 days for dev, 90 days for prod).
- AWS Budgets alert is recommended at $20/month per environment (not provisioned
  by CDK to avoid requiring billing permissions in the deployment role).
- EventBridge Scheduler is disabled in dev environments when not actively
  testing to avoid unnecessary Lambda invocations.

---

## Passing stage to CDK constructs

Every CDK stack and construct receives the `KiteWindowEnvironment` through its
props. Do not read `process.env` inside constructs. Always propagate the
environment through the stack props chain:

```typescript
// In bin/app.ts
const env = resolveEnvironment(stageFromContext(app.node));
new FoundationStack(app, env.stackName, { env: env.awsEnv, kiteWindowEnv: env });

// Inside a construct
export class MyConstruct extends Construct {
  constructor(scope: Construct, id: string, props: { kiteWindowEnv: KiteWindowEnvironment }) {
    super(scope, id);
    const bucket = new Bucket(this, 'Bucket', {
      bucketName: `${props.kiteWindowEnv.resourcePrefix}-data`,
      removalPolicy: props.kiteWindowEnv.removalPolicy,
    });
  }
}
```
