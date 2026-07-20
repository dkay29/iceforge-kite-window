# Create West Dennis end-to-end acceptance test

Labels: testing,release

## Goal

Validate the complete flow from public APIs to mobile-ready forecast.

## Acceptance criteria

- Recorded fixture produces a known three-hour low-tide window.
- Unsafe offshore fixture produces NO GO.
- Stale source fixture produces explicit stale status.
- Published JSON validates against schema.
- API response and mobile graph fixture agree on all timeline points.

## Dependencies

#13, #18
