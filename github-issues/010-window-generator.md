# Generate candidate three-hour low-tide windows

Labels: backend,engine

## Goal
Generate every eligible three-hour session window containing low tide.

## Acceptance criteria
- Candidate starts are evaluated at the configured interval.
- Multiple low tides per date are supported.
- Full-session daylight rules are supported.
- Window metadata includes low-tide offset from center.
- Tests cover low tide near sunrise, sunset, and date boundaries.

## Dependencies
#8
