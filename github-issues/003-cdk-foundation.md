# Create AWS CDK foundation

Labels: infrastructure,aws

## Goal
Provision the baseline AWS environment using CDK in TypeScript.

## Acceptance criteria
- S3 buckets or prefixes for config, raw, normalized, published, current, and user data.
- Encryption, versioning, block-public-access, and lifecycle rules configured.
- API Gateway HTTP API, Lambda execution roles, and CloudWatch log groups created.
- EventBridge Scheduler created for forecast refresh.
- Outputs provide bucket names and API base URL.

## Dependencies
#1
