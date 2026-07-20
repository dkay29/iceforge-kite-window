# Implement NOAA CO-OPS tide adapter

Labels: backend,data-source

## Goal

Retrieve high/low events and curve data for the selected tide station.

## Acceptance criteria

- Supports prediction and observed water-level products.
- Uses configured datum, units, and local time behavior.
- Raw responses are written to S3.
- High/low events and curve points are normalized.
- Tests cover daylight-saving transitions and provider errors.

## Dependencies

#2, #3, #4
