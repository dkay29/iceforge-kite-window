# Add observability, alarms, and operational runbooks

Labels: operations,aws

## Goal
Make provider failures, stale forecasts, pipeline failures, and push failures visible.

## Acceptance criteria
- Structured CloudWatch logs include spot, run, provider, and request identifiers.
- Metrics and alarms cover age of current forecast, Lambda errors, provider failures, and publish failures.
- Dashboard and runbook are committed.
- Cost monitoring and retention settings are documented.

## Dependencies
#3, #12, #13, #15
