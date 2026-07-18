# Iceforge Kite Window

A serverless AWS-backed mobile application that answers one question clearly:

> When is it safe and worthwhile to go kitesurfing at a selected spot?

The initial spot is West Dennis Beach, Massachusetts. The first decision model requires an onshore or side-onshore wind and a three-hour session window containing low tide. The UI combines wind, gusts, tide, daylight, confidence, and suitability into one intuitive timeline.

## Repository status

This is an initialization package containing:

- The complete initial design and decision history
- A proposed AWS serverless architecture
- Canonical JSON schemas
- A GitHub issue implementation plan
- Starter directory structure for backend, infrastructure, and mobile work
- The original source screenshots and the approved iPhone concept mockup

## Proposed stack

- **Mobile:** React Native + TypeScript, AWS Amplify libraries
- **Authentication:** Amazon Cognito
- **API:** API Gateway HTTP API + Lambda
- **Forecast pipeline:** EventBridge Scheduler + Lambda, optionally Step Functions later
- **Storage:** Amazon S3 keyed JSON objects, not DynamoDB
- **Notifications:** AWS End User Messaging Push via APNs and FCM
- **Infrastructure as code:** AWS CDK with TypeScript
- **Public data:** NOAA CO-OPS and National Weather Service APIs

## Quick start

```bash
npm install
npm run validate:schemas
```

The implementation work is organized in [`github-issues/`](github-issues/) and summarized in [`docs/issues-plan.md`](docs/issues-plan.md).

## Key documents

- [Initial design and full conversation history](docs/initial-design.md)
- [Architecture](docs/architecture.md)
- [GitHub issue plan](docs/issues-plan.md)
- [API contract](docs/api-contract.md)
- [S3 key design](docs/s3-key-design.md)
