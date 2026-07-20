# CLAUDE.md — Iceforge Kite Window

This file defines the operating rules for Claude Code when working in the
`iceforge-kite-window` repository.

## Authoritative project baseline

Read these files before making changes:

1. `PROJECT-INSTRUCTIONS.md`
2. `docs/initial-design.md`
3. `docs/architecture.md`
4. `docs/api-contract.md`
5. `docs/s3-key-design.md`
6. `docs/issues-plan.md`
7. `schemas/*.schema.json`

Treat `PROJECT-INSTRUCTIONS.md` and `docs/initial-design.md` as authoritative.

When implementation details conflict with the accepted architecture:

- Stop and identify the conflict.
- Preserve the accepted S3-first architecture.
- Do not silently introduce a replacement design.
- Record any required architecture decision or follow-up issue.

## Core architecture constraints

The accepted technical direction is:

- React Native and TypeScript for iOS and Android
- AWS API Gateway HTTP API and Lambda
- Amazon Cognito for authentication
- Amazon S3 for keyed storage
- EventBridge Scheduler for refreshes
- AWS CDK in TypeScript
- AWS End User Messaging Push for APNs and FCM
- National Weather Service API for initial weather data
- NOAA CO-OPS API for initial tide data
- Calculated sunrise and sunset from spot coordinates and timezone

Do not introduce DynamoDB unless an explicit architecture decision authorizes it.

Provider interfaces must allow higher-resolution wind providers to be added later.

## Development workflow

Work on one GitHub issue per branch unless the issue explicitly requires otherwise.

Before editing:

1. Read the selected GitHub issue and its acceptance criteria.
2. Inspect the current repository structure and relevant implementation.
3. Identify dependencies, existing conventions, and affected contracts.
4. Check for conflicts with the authoritative project documents.
5. Produce a concise implementation plan.

During implementation:

- Implement only the selected issue.
- Avoid unrelated cleanup or speculative features.
- Keep changes incremental and reviewable.
- Add or update tests for every changed behavior.
- Update documentation, schemas, contracts, and examples when behavior changes.
- Do not duplicate backend decision logic in the mobile application.
- Do not commit secrets, credentials, tokens, or local environment files.

At completion, report:

- Files changed
- Behavior implemented
- Design decisions made
- Tests and validation commands run
- Remaining risks
- Follow-up issues needed

## Branch and pull-request conventions

Recommended branch naming:

```text
issue-<number>-<short-description>
```

Examples:

```text
issue-1-repository-readiness
issue-12-s3-key-builders
```

Pull requests must:

- Reference the GitHub issue.
- Include `Closes #<issue-number>` when the PR fully resolves it.
- Summarize contract, schema, infrastructure, and test changes.
- Call out assumptions and residual risks.
- Avoid combining unrelated issues.

## Required validation before commit

Run all applicable repository validation commands before committing:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run validate:schemas
npm run synth
```

All commands must pass.

Do not claim completion when a required command:

- Was not run
- Failed
- Was skipped because of an unrelated local problem
- Does not exist yet

If a required command does not exist, either add it as part of the current
repository-readiness issue or report it as a blocking gap.

Do not weaken or remove checks merely to obtain a passing build.

## TypeScript standards

- Use strict TypeScript.
- Avoid `any`; use `unknown` plus validation when consuming external data.
- Prefer small, explicit interfaces and pure domain functions.
- Use exhaustive handling for discriminated unions.
- Keep AWS SDK and provider-specific types out of core domain packages.
- Generate TypeScript types from canonical schemas when that is the repository convention.
- Do not maintain handwritten types that duplicate generated schema types.
- Export only APIs intended for cross-package use.

## Schema and contract rules

Version:

- Spot configurations
- Rulesets
- JSON schemas
- API contracts
- Published forecast documents
- Persisted S3 documents

Validate all external payloads before using them.

When a contract changes, update together:

1. JSON schema
2. Generated TypeScript types
3. Example documents
4. Producer implementation
5. Consumer implementation
6. Unit and integration tests
7. Documentation

Preserve backward compatibility unless the issue explicitly authorizes a
breaking change.

## Domain rules

- Store wind direction in degrees.
- Treat wind direction as meteorological wind-from direction.
- Use circular-angle arithmetic.
- Use the spot's IANA timezone for local dates and solar calculations.
- Normalize source data to the canonical 15-minute timeline.
- Keep hard safety constraints separate from weighted scoring.
- Ensure one unsafe interval cannot be hidden by a good average.
- Make missing, stale, interpolated, and partial data explicit.
- Preserve source attribution, retrieval timestamps, and validity timestamps.
- Return reasons, warnings, and blocking constraints with every recommendation.

Do not infer or invent:

- NOAA station selection
- NWS grid mapping
- Shore bearing
- Accepted wind sectors
- User safety thresholds

Use only validated configuration committed to the repository.

## Decision-engine rules

The backend owns:

- Candidate-window generation
- Hard-rule evaluation
- Scoring
- Weakest-point weighting
- Best-window selection
- Reasons and warnings
- Final status

The mobile application renders presentation-ready backend documents and must not
reconstruct these rules independently.

Use deterministic algorithms and tie-breaking.

Add tests for:

- Direction wrapping around 0° and 360°
- Onshore and offshore classification boundaries
- Interpolation boundaries
- Low-tide window generation
- Sunrise and sunset boundaries
- Daylight requirements
- Gust limits
- Missing and stale data
- Scoring thresholds
- Weakest-point behavior
- Equal-score tie-breaking

## Provider adapter rules

Provider adapters must:

- Validate external responses
- Preserve raw attribution and timestamps
- Use captured fixtures for integration tests
- Handle timeouts, retries, malformed data, empty data, and provider errors
- Avoid overwriting a valid current forecast after a failed refresh
- Remain isolated behind provider interfaces

Do not make routine tests depend on live public APIs.

## S3 rules

Use deterministic S3 keys.

Separate:

- Configuration
- Raw provider responses
- Normalized timelines
- Immutable published assessments
- Current pointers
- User preferences
- Device registrations

Published forecast-run objects are immutable.

Update a stable current pointer only after all immutable objects for the run have
been successfully written and validated.

Use ETags and conditional writes where concurrency matters.

Do not replace the S3-first persistence model with a database without explicit
approval.

## AWS infrastructure rules

Infrastructure changes must be defined in AWS CDK.

Apply:

- Encryption
- Public-access blocking
- Least-privilege IAM
- Explicit retention and removal policies
- Structured logging
- Correlation IDs
- Environment-aware naming
- Resource tags
- Safe defaults for development and production

Pull-request validation must not require live AWS credentials.

`npm run synth` must succeed locally and in CI.

## Testing expectations

Use:

- Unit tests for pure domain behavior
- Integration tests with captured NWS and NOAA fixtures
- Schema-validation tests for all example documents
- Infrastructure synthesis tests where appropriate
- Regression tests for fixed defects

Tests should be deterministic and independent of current weather, live provider
availability, or the developer's timezone.

## Documentation expectations

Update documentation whenever implementation changes:

- Public contracts
- S3 keys
- Configuration structure
- Domain rules
- Deployment behavior
- Local development commands
- Operational behavior

Document assumptions explicitly instead of hiding them in code.

## GitHub Project status helper

Use the repository helper to update roadmap status:

```bash
./tools/update-issue-status.sh <issue-number> "In Progress"
./tools/update-issue-status.sh <issue-number> Review
./tools/update-issue-status.sh <issue-number> Done
```

Move an issue to:

- `In Progress` when implementation begins
- `Blocked` when a prerequisite prevents progress
- `Review` when the pull request is ready
- `Done` only after the change is merged and validation passes

## Completion standard

An issue is complete only when:

- Every acceptance criterion is satisfied
- Required tests have been added
- Required documentation and schemas are updated
- All validation commands pass
- No known regression is left unreported
- The pull request references the issue
- Remaining work is captured in explicit follow-up issues

## GitHub access in containers

Claude may run without GitHub network access.
When working on an issue, read the exported issue file:
`.claude/issues/issue-<number>.md`
Treat that file as the authoritative issue content.
Do not attempt to fetch GitHub issues from inside the container unless access is explicitly available.

## Autonomy

When implementing an approved task:

- Work autonomously through editing, validation, and local Git commits.
- Do not ask before running local commands.
- Do not ask before creating a local commit when all checks pass.
- Never push, create pull requests, or perform remote GitHub mutations unless
  explicitly requested.
