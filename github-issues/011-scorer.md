# Implement suitability scoring and explanations

Labels: backend,engine,safety

## Goal
Apply hard constraints and weighted scoring to forecast points and candidate windows.

## Acceptance criteria
- Hard failures produce NO GO and blocking reasons.
- Point score components total correctly.
- Window aggregation weights minimum and average point scores.
- GO and MARGINAL thresholds are ruleset-driven.
- Human-readable reasons and warnings are generated deterministically.
- Trend is classified as improving, steady, or deteriorating.

## Dependencies
#9, #10
