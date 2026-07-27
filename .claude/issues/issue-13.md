# Issue #13 — Implement immutable forecast publication and current pointers

URL: https://github.com/dkay29/iceforge-kite-window/issues/13
State: OPEN

Labels: infrastructure priority:p1 phase:mvp

## Description

## Outcome

Implement safe publication without exposing partial runs.

## Acceptance criteria

- Immutable objects are verified before the current pointer changes.
- Conditional writes, rollback, and missing-target behavior are tested.

## Dependencies

S3 key builders; schemas

---

Roadmap source: `tools/create-roadmap-project.sh`
