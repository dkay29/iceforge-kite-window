# Implement personal suitability settings and kite inventory

Labels: mobile,product

## Goal

Allow the user to personalize acceptable wind range, gust spread, session length, direction classes, notifications, and kite inventory.

## Acceptance criteria

- Settings validate against server-supported ranges.
- Conflict response from ETag mismatch is handled.
- Kite inventory supports size and optional usable wind range.
- Changes cause personalized forecast refresh.

## Dependencies

#14, #16
