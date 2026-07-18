# Publish immutable forecasts and current pointers to S3

Labels: backend,storage

## Goal
Publish normalized and assessed forecasts using deterministic S3 keys.

## Acceptance criteria
- Immutable run documents are created.
- Current pointers are replaced only after a successful complete run.
- Revision and ETag behavior is documented.
- Partial pipeline failure never corrupts the current forecast.
- Lifecycle and retention policies are verified.

## Dependencies
#3, #11
