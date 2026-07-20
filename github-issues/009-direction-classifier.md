# Implement beach-relative wind direction classifier

Labels: backend,engine,safety

## Goal

Classify wind relative to the spot shoreline as direct onshore, side-onshore, cross-shore, side-offshore, or offshore.

## Acceptance criteria

- Circular-angle calculations correctly handle zero-degree wraparound.
- Spot-specific accepted sectors are supported.
- Classification includes distance to the nearest safety boundary.
- Comprehensive boundary tests are included.

## Dependencies

#2, #4
