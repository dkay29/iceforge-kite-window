# NOAA CO-OPS Tide Station: West Dennis Beach (Issue #3)

This document records the NOAA CO-OPS tide station selected for West Dennis Beach,
the suitability rationale, datum information, confirmed prediction retrieval, and
fallback policy.

## Selected station

| Field                | Value                       |
| -------------------- | --------------------------- |
| Station ID           | **8447504**                 |
| Name                 | South Yarmouth, Bass River  |
| Station type         | Subordinate (`S`)           |
| Reference station    | Boston, MA — 8443970        |
| Latitude             | 41.665° N                   |
| Longitude            | −70.1833° W                 |
| Distance from spot   | ~1.8 km (great-circle)      |
| Tidal datum          | MLLW (Mean Lower Low Water) |
| Available products   | `predictions`               |
| Prediction intervals | `hilo` (hi-lo extrema only) |

### Why Bass River (8447504)

West Dennis Beach (41.6494° N, −70.1845° W) faces Nantucket Sound. The Bass River
tidal inlet bounds the east end of the beach; station 8447504 sits at the river
mouth, placing it within ~1.8 km of the launch area.

The NOAA CO-OPS station list for Massachusetts was queried on 2026-07-26 using the
`type=tidepredictions` filter. All stations between 41.0° – 42.5° N and
−71.5° – −69.5° W were evaluated. Station 8447504 was closest to the spot by a
wide margin (next nearest: 8447525 Dennisport at ~7 km).

### Station type: subordinate

Station 8447504 is a subordinate (`S`) station. It was established as a temporary
gauge for eight days in October 1983 and does not operate a real-time sensor.
Predictions are computed by the NOAA CO-OPS engine using offsets applied to the
harmonic reference station at Boston (8443970):

| Offset                 | Value        |
| ---------------------- | ------------ |
| High-water time offset | +108 minutes |
| Low-water time offset  | +106 minutes |
| Height offset type     | Ratio (`R`)  |
| Height ratio           | 0.29         |

Subordinate station predictions are the standard NOAA mechanism for locations
without active gauges. The prediction API accepts them identically to harmonic
stations.

### Tidal datum: MLLW

Mean Lower Low Water (MLLW) is the standard NOAA CO-OPS datum for US tide
predictions. All height values returned by the predictions API for this station
are referenced to MLLW.

The station has no published datum sheet (no active benchmark network for this
temporary gauge), so height values are derived entirely from the reference
station's datums adjusted by the ratio offset.

### Tidal character

Station 8447504 is listed by NOAA as `tideType: "Mixed"`. Nantucket Sound exhibits
a mixed semi-diurnal tidal pattern with two unequal highs and two unequal lows per
day. The diurnal inequality is more pronounced than on the outer Atlantic coast.

### Confirmed prediction retrieval

Hi-lo predictions were successfully retrieved on 2026-07-26 using:

```
GET https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
  ?begin_date=20260725
  &end_date=20260726
  &station=8447504
  &product=predictions
  &datum=MLLW
  &time_zone=lst_ldt
  &interval=hilo
  &units=english
  &application=iceforge_kite_window
  &format=json
```

Sample response excerpt (2026-07-25, LST/LDT):

| Time  | Height (ft) | Type |
| ----- | ----------- | ---- |
| 04:47 | 0.398       | L    |
| 11:03 | 2.340       | H    |
| 16:46 | 0.634       | L    |
| 23:09 | 2.751       | H    |

A captured fixture is stored at:
`backend/src/providers/noaa/fixtures/predictions-8447504-hilo-20260725.json`

**6-minute interval predictions** are not available for subordinate stations
(API returns `No Predictions data was found` for `interval=6`). The operational
prediction interval for this station is `hilo` (hi-lo extrema). The decision
engine must interpolate a continuous tidal curve from hi-lo extrema; see
the tide-adapter issue for interpolation requirements.

## Fallback policy

If the primary station (8447504) fails:

1. **Try fallback station 8447525 (Dennisport)** — subordinate station on
   Nantucket Sound, 7 km east of West Dennis Beach; same reference station
   (Boston 8443970). Verified to return hi-lo predictions (retrieval confirmed
   on 2026-07-26).

2. **If all stations fail** — set forecast status to `NO_GO`. Do not publish a
   forecast. Surface an explicit user-visible error noting that tide data is
   unavailable. Do not present stale tide data as current.

This policy is encoded in `sources.noaaTideStation.fallback` in the spot
configuration document.

### Why not use the reference station (Boston 8443970) as a manual fallback

The time offset between Boston and West Dennis is approximately 108 minutes (HW)
and 106 minutes (LW). Using Boston predictions directly without the subordinate
station machinery would require re-implementing the NOAA offset calculation in the
adapter and would introduce additional accuracy risk. The correct fallback is
another subordinate station on the same water body, not a manual offset from Boston.

## Comparison with Dennisport (8447525)

| Attribute             | 8447504 Bass River | 8447525 Dennisport |
| --------------------- | ------------------ | ------------------ |
| Distance from spot    | ~1.8 km            | ~7 km              |
| Station type          | S                  | S                  |
| Reference station     | Boston 8443970     | Boston 8443970     |
| HW time offset        | +108 min           | +63 min            |
| LW time offset        | +106 min           | +38 min            |
| Height ratio          | 0.29               | 0.36               |
| Predictions available | Yes (hilo)         | Yes (hilo)         |

The 45-minute difference in high-water time and the different height ratios
reflect genuine tidal phase variation along Nantucket Sound. Bass River is
co-located with the beach and is the correct primary station.

## Out of scope for issue #3

- NOAA CO-OPS provider adapter implementation (later issue)
- Tidal curve interpolation from hi-lo extrema (later issue)
- NWS grid-point selection (issue #4)
- Shore bearing and wind sectors (issue #5)
