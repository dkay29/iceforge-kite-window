# Shore Bearing and Wind Sectors: West Dennis Beach (Issue #5)

This document defines the seaward bearing semantics, the estimated bearing for
West Dennis Beach, the derived wind-sector boundaries, and domain review examples.

## Semantics

### Seaward bearing

`seawardBearingDegrees` is the **compass bearing, in degrees true, pointing from
the beach toward open water**. It is the direction a kitesurfer faces when looking
out to sea from the launch area.

- 0° = north, 90° = east, 180° = south, 270° = west (clockwise from north)
- The bearing is measured as a geographic azimuth, not a magnetic compass reading

### Wind direction convention

All wind directions in this project follow the **meteorological FROM convention**:
a wind direction of X° means the wind is _blowing from_ X° toward X° + 180°.

- Wind from 195° (SSW) blows _toward_ 15° (NNE)
- An **onshore wind** has a FROM-direction close to the seaward bearing: it
  originates over the water and pushes the kitesurfer toward the beach
- An **offshore wind** has a FROM-direction close to the **landward** bearing
  (seawardBearing + 180°): it originates over the land and would blow the
  kitesurfer away from shore

### Classification algorithm

Given seaward bearing B and wind FROM-direction W, compute the absolute angular
difference φ using circular arithmetic:

```
diff  = (W - B + 360) mod 360
φ     = diff ≤ 180 ? diff : 360 − diff     # normalize to [0°, 180°]
```

| φ range         | Classification | Accepted at West Dennis |
| --------------- | -------------- | ----------------------- |
| 0° ≤ φ ≤ 30°    | DIRECT_ONSHORE | Yes                     |
| 30° < φ ≤ 75°   | SIDE_ONSHORE   | Yes                     |
| 75° < φ ≤ 90°   | CROSS_SHORE    | No                      |
| 90° < φ ≤ 135°  | SIDE_OFFSHORE  | No                      |
| 135° < φ ≤ 180° | OFFSHORE       | No                      |

### Sector wrap convention

When `startDegrees > endDegrees` in a `windSector` object, the arc **wraps
through 0°/360°**. For example, startDegrees: 330, endDegrees: 60 covers the
arc 330°→360°(=0°)→60°, which spans northerly directions.

---

## West Dennis Beach bearing

### Estimated value: 195°

| Attribute    | Value                     |
| ------------ | ------------------------- |
| Bearing      | **195°** (SSW)            |
| Basis        | Geographic estimate       |
| Verification | Required — see note below |

West Dennis Beach is a south-facing barrier beach on the south shore of Cape Cod,
bordering Nantucket Sound. The relevant NOAA nautical chart is **13229**
(confirmed in the NOAA CO-OPS station record for station 8447504). The shoreline
at the west end of the beach (near the Bass River inlet, the kite launch area)
runs approximately WNW–ESE. The perpendicular toward Nantucket Sound is
approximately SSW.

The value 195° (5° west of due south) is derived from:

- The general south-facing orientation of the Cape Cod south shore in the Dennis/
  Yarmouth area
- The slight WNW–ESE tilt of the shoreline at the launch point (41.6494°N,
  −70.1845°W)
- Public geographic knowledge of the Cape Cod Nantucket Sound coastline

**Verification required.** This bearing must be confirmed against NOAA chart 13229
or a comparable authoritative source before the spot is activated (`active: true`).
If the confirmed bearing differs from 195°, all sector boundaries must be
recomputed from the corrected value.

---

## Derived wind sectors

The following sectors are stored in `west-dennis-beach-ma.json` under `shore`.

### Accepted sectors

| Sector         | FROM-direction range | Classification |
| -------------- | -------------------- | -------------- |
| Direct onshore | 165°–225°            | DIRECT_ONSHORE |
| Side-onshore S | 120°–165°            | SIDE_ONSHORE   |
| Side-onshore W | 225°–270°            | SIDE_ONSHORE   |

Wind coming from anywhere in 120°–270° is accepted (onshore or side-onshore).

### Prohibited sectors

| Sector            | FROM-direction range             | Classification |
| ----------------- | -------------------------------- | -------------- |
| Cross-shore ESE   | 105°–120°                        | CROSS_SHORE    |
| Cross-shore WNW   | 270°–285°                        | CROSS_SHORE    |
| Side-offshore ENE | 60°–105°                         | SIDE_OFFSHORE  |
| Side-offshore WNW | 285°–330°                        | SIDE_OFFSHORE  |
| Offshore (N arc)  | 330°–60° (wraps through 0°/360°) | OFFSHORE       |

---

## Domain review examples

All examples use seawardBearingDegrees = 195°.

### Example 1 — SSW wind (textbook onshore)

Wind FROM 200°. diff = (200 − 195 + 360) mod 360 = 5°. φ = 5°.
→ DIRECT_ONSHORE, accepted. ✓

### Example 2 — SE wind (side-onshore, south-southeast component)

Wind FROM 150°. diff = (150 − 195 + 360) mod 360 = 315°. φ = 360 − 315 = 45°.
→ SIDE_ONSHORE, accepted. ✓

### Example 3 — SW wind (side-onshore, southwesterly)

Wind FROM 240°. diff = (240 − 195 + 360) mod 360 = 45°. φ = 45°.
→ SIDE_ONSHORE, accepted. ✓

### Example 4 — ESE wind (cross-shore, not accepted)

Wind FROM 112°. diff = (112 − 195 + 360) mod 360 = 277°. φ = 360 − 277 = 83°.
→ CROSS_SHORE, not accepted. ✗

### Example 5 — NE wind (side-offshore, dangerous)

Wind FROM 45°. diff = (45 − 195 + 360) mod 360 = 210°. φ = 360 − 210 = 150°.
→ OFFSHORE, not accepted. ✗

### Example 6 — N wind (offshore, extremely dangerous)

Wind FROM 360° (= 0°). diff = (0 − 195 + 360) mod 360 = 165°. φ = 165°.
→ OFFSHORE, not accepted. ✗

### Example 7 — NW wind (offshore arc, wrapping sector)

Wind FROM 320°. diff = (320 − 195 + 360) mod 360 = 125°. φ = 125°.
→ SIDE_OFFSHORE, not accepted. ✗

Wind FROM 340°. diff = (340 − 195 + 360) mod 360 = 145°. φ = 145°.
→ OFFSHORE (in the wrapping sector 330°–60°), not accepted. ✗

### Example 8 — 0°/360° boundary wrap check

Wind FROM 0°. diff = (0 − 195 + 360) mod 360 = 165°. φ = 165°.
→ OFFSHORE, not accepted. ✗

Wind FROM 359°. diff = (359 − 195 + 360) mod 360 = 164°. φ = 164°.
→ OFFSHORE, not accepted. ✗

---

## Boundary sensitivity

If the seaward bearing is confirmed at 190° (5° shift east):

| Sector              | Current (195°) | Adjusted (190°) | Shift |
| ------------------- | -------------- | --------------- | ----- |
| DIRECT_ONSHORE      | 165°–225°      | 160°–220°       | −5°   |
| SIDE_ONSHORE (SE)   | 120°–165°      | 115°–160°       | −5°   |
| SIDE_ONSHORE (SW)   | 225°–270°      | 220°–265°       | −5°   |
| CROSS_SHORE (E)     | 105°–120°      | 100°–115°       | −5°   |
| CROSS_SHORE (W)     | 270°–285°      | 265°–280°       | −5°   |
| SIDE_OFFSHORE (ENE) | 60°–105°       | 55°–100°        | −5°   |
| SIDE_OFFSHORE (WNW) | 285°–330°      | 280°–325°       | −5°   |
| OFFSHORE (N arc)    | 330°–60°       | 325°–55°        | −5°   |

A 5° bearing change shifts all boundaries equally. The classification of most
common wind directions is not sensitive to a ±5° bearing error.

---

## Verification checklist

Before setting `active: true`:

1. Open NOAA nautical chart 13229 (or equivalent authoritative source).
2. Find the kite launch area at the west end of West Dennis Beach (near the Bass
   River inlet).
3. Measure the bearing from the beach perpendicular to the shoreline, pointing
   toward Nantucket Sound.
4. If the bearing differs from 195°, update `shore.seawardBearingDegrees` and
   recompute all sector boundaries using the classification algorithm above.
5. Update `sourceNotes` and `validationStatus` accordingly.
6. Update `active` to `true` only after all other required fields are also
   verified.

## Out of scope for issue #5

- Wind-direction classification algorithm implementation (issue #7)
- Hard constraint evaluation (later issue)
- Scoring and session window generation
