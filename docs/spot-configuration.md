# Spot Configuration: West Dennis Beach (Issue #2)

This document records the canonical West Dennis spot configuration
(`backend/src/config/spots/west-dennis-beach-ma.json`, validated against
`schemas/spot.schema.json`) and the evidence, assumptions, and unresolved
fields behind it.

Issue #2 validates identity, location, timezone, and version metadata. It does
not select a NOAA tide station, resolve an NWS grid mapping, determine shore
bearing, or define accepted/prohibited wind sectors — those are owned by later
issues (see [Unresolved fields](#unresolved-fields) below) and are intentionally
absent from the configuration document rather than populated with placeholder
values.

## Established values and evidence

| Field                | Value                  | Evidence                                                                                                                                                                                        |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spotId`             | `west-dennis-beach-ma` | Assigned per issue #2 task instructions.                                                                                                                                                        |
| `name`               | `West Dennis Beach`    | `docs/initial-design.md:11`, `PROJECT-INSTRUCTIONS.md:13`                                                                                                                                       |
| `municipality`       | `Dennis`               | Town of Dennis, Massachusetts. Verified by the project owner using live authoritative sources outside the container.                                                                            |
| `village`            | `West Dennis`          | Postal village (locality) within the Town of Dennis. Same source as municipality.                                                                                                               |
| `state`              | `Massachusetts`        | `docs/initial-design.md:11`, `PROJECT-INSTRUCTIONS.md:13`                                                                                                                                       |
| `countryCode`        | `US`                   | Not stated verbatim; inferred because Massachusetts is a U.S. state and the project's named providers (NWS, NOAA CO-OPS) are U.S. federal agencies.                                             |
| `location.latitude`  | `41.6494`              | Massachusetts DPH water-quality monitoring point "West Dennis (West) — Location 1" (site `21MABCH-MA649766-1`). NAD83 datum. Sourced by the project owner from live data outside the container. |
| `location.longitude` | `-70.1845`             | Same source as latitude.                                                                                                                                                                        |
| `location.datum`     | `NAD83`                | Reported by the Massachusetts DPH monitoring-site record.                                                                                                                                       |
| `location.timezone`  | `America/New_York`     | Assigned per issue #2 task instructions; consistent with Massachusetts.                                                                                                                         |
| `launchPoint`        | `41.6494, -70.1845`    | Same coordinate as `location`: the DPH monitoring point at the west end of West Dennis Beach. Used as the initial representative launch coordinate; may be supplemented in a later issue.       |
| `version`            | `2`                    | Revision 2: adds municipality, village, location coordinates, datum, and launchPoint.                                                                                                           |
| `validationStatus`   | `PARTIALLY_VALIDATED`  | Identity, timezone, and geographic coordinate fields are established; all safety-critical and provider fields remain unresolved.                                                                |
| `active`             | `false`                | Must stay `false` until shore bearing, wind sectors, and provider mappings are validated and `validationStatus` reaches `VALIDATED`.                                                            |

### Launch point note

The launch point coordinate is the Massachusetts Department of Public Health
water-quality monitoring point named **West Dennis (West) — Location 1**
(site identifier `21MABCH-MA649766-1`), located at the west end of West Dennis
Beach. It is the authoritative public reference point nearest the kite-launch
area. A later issue may define a more precise launch-area coordinate or
additional named launch points if the active launch area is better
characterized by a different position.

## Unresolved fields

Recorded in the `unresolved` array of the configuration document:

| Field                                                  | Reason                                                | Owning follow-up                                           |
| ------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------- |
| `shore.seawardBearingDegrees`                          | Requires a site survey.                               | #5                                                         |
| `shore.acceptedWindSectors` / `.prohibitedWindSectors` | Depend on validated shore bearing.                    | #5                                                         |
| `sources.noaaTideStation`                              | NOAA CO-OPS tide-station selection not yet performed. | #3                                                         |
| `sources.nwsGridpoint`                                 | NWS grid-point/endpoint resolution not yet performed. | #4                                                         |
| `defaultRulesetId`                                     | No ruleset authored/published yet.                    | Unassigned — later phase per `docs/issues-plan.md` Phase 2 |

## Schema changes

`schemas/spot.schema.json` was updated to add:

- `village` — optional string for postal sub-municipal locality names.
- `location.datum` — optional string for the geodetic datum of the coordinate pair.
- `launchPoint.datum` — same, on the launch-point object.

All three additions are optional. Existing documents without these fields
continue to validate.

## Out of scope for this issue

No provider adapters, network calls, tide calculations, wind-direction
classification, decision-engine logic, S3 persistence, or AWS infrastructure
were implemented or modified.
