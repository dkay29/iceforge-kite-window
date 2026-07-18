# Implement National Weather Service adapter

Labels: backend,data-source

## Goal
Fetch weather, wind, gust, direction, observations, and active alerts from NWS public APIs.

## Acceptance criteria
- Provider client uses timeouts, retries, user-agent identification, and structured errors.
- Raw responses are written to S3.
- Forecast-run and observation timestamps are retained.
- Contract tests use recorded fixtures.
- Missing or malformed fields are handled explicitly.

## Dependencies
#2, #3, #4
