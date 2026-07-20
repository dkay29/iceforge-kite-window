# Build 15-minute forecast normalizer

Labels: backend,engine

## Goal

Combine weather, tide, and daylight data into a canonical 15-minute timeline.

## Acceptance criteria

- Interpolation rules are documented by field.
- Circular interpolation is used for wind direction.
- Missing values and confidence are represented explicitly.
- Tide trend is classified as rising, falling, slack, or unknown.
- Normalized documents are written immutably to S3.

## Dependencies

#5, #6, #7
