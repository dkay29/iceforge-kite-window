# Units, Timestamps, and Interval Semantics (Issue #6)

This document is the normative reference for all unit, timestamp, and interval
conventions used in Iceforge Kite Window. Implementations must follow these
conventions exactly. When a source provides data in a different unit or format,
the adapter layer converts before passing data to domain logic.

---

## Wind speed and gust

| Field            | Canonical unit | Stored as | Notes                                                      |
| ---------------- | -------------- | --------- | ---------------------------------------------------------- |
| `windSpeedKnots` | knots (kt)     | `number`  | 1 kt = 1.852 km/h = 0.514 m/s. Sustained 1-minute average. |
| `gustSpeedKnots` | knots (kt)     | `number`  | Peak 3-second gust within the observation/forecast period. |

**Rationale:** Kitesurfing thresholds are commonly expressed in knots. NWS
provides wind in km/h (grid data) or mph (hourly strings); NOAA observations
use knots. All values are converted to knots in the adapter layer.

---

## Wind direction

| Field                  | Canonical unit     | Stored as | Notes                                                                           |
| ---------------------- | ------------------ | --------- | ------------------------------------------------------------------------------- |
| `windDirectionDegrees` | degrees true, FROM | `number`  | 0° = north, 90° = east, 180° = south, 270° = west (clockwise). Always 0–359.9°. |

- Wind direction uses the **meteorological FROM convention** (the direction the
  wind is blowing FROM, not toward).
- 0° and 360° represent the same direction; store as 0°.
- Calm wind (speed < 0.5 kt) is encoded as speed: 0, direction: null.
- Variable wind (direction changes > 60° within period) is encoded as
  direction: null with a `variableWind: true` flag on the timeline point.

---

## Temperature

| Field                | Canonical unit | Stored as | Notes                     |
| -------------------- | -------------- | --------- | ------------------------- |
| `temperatureCelsius` | °C             | `number`  | One decimal place (0.1°C) |

---

## Tide height

| Field            | Canonical unit | Stored as | Notes                                                                        |
| ---------------- | -------------- | --------- | ---------------------------------------------------------------------------- |
| `tideHeightFeet` | feet (ft)      | `number`  | Relative to MLLW datum. Two decimal places (0.01 ft). Negative values valid. |
| `tideDatum`      | n/a            | `string`  | Always `"MLLW"` for the current spot configuration.                          |

**Rationale:** NOAA CO-OPS returns predictions in feet (when `units=english`).
The decision engine uses feet to match NOAA output directly and avoid float
conversion error on a safety-critical field.

---

## Suitability score

| Field   | Canonical unit | Stored as | Notes                                           |
| ------- | -------------- | --------- | ----------------------------------------------- |
| `score` | integer 0–100  | `number`  | Higher is better. See scoring spec (issue #20). |

---

## Timestamps

### Wall-clock timestamps

All wall-clock timestamps are stored as **ISO 8601 strings with explicit UTC
offset**:

```
"2026-07-26T14:00:00-04:00"   ✓  (local time with Eastern Daylight Time offset)
"2026-07-26T18:00:00+00:00"   ✓  (UTC)
"2026-07-26T14:00:00"         ✗  (offset omitted — not allowed)
"2026-07-26"                  ✓  for local calendar dates only (see below)
```

Rules:

- Use the **spot's IANA timezone** when representing times for human display
  (e.g., tide tables, forecast periods, session windows).
- Use **UTC** for internal run keys, retrieval timestamps, and publication
  timestamps.
- Never store a naive (offset-less) timestamp for a wall-clock value.

### Retrieval and publication timestamps

Fields like `retrievedAt`, `publishedAt`, and `runAt` use UTC ISO 8601:

```
"retrievedAt": "2026-07-26T18:00:00+00:00"
```

### Local calendar dates

A "local date" is the calendar date in the spot's timezone. Store as an ISO 8601
date string (`YYYY-MM-DD`), not a timestamp:

```
"localDate": "2026-07-26"
```

A local date does not carry time-of-day or offset information. The spot's IANA
timezone (`America/New_York`) must be used alongside it for any date arithmetic.

---

## DST behavior

West Dennis Beach uses `America/New_York`:

- **EST (UTC−5):** November–March
- **EDT (UTC−4):** March–November (DST active)

Rules:

- All date arithmetic (e.g., generating a 15-minute timeline for a calendar day)
  must use the spot's IANA timezone, not a fixed offset.
- Spring-forward (23-hour day): the missing hour is treated as having no data;
  all 15-minute points in the gap are marked `dataSource: "MISSING"`.
- Fall-back (25-hour day): the repeated hour is disambiguated by its UTC value.
  Both instances are included in the timeline. Duplicate local times are
  distinguished by their UTC offset (e.g., 01:30−04:00 and 01:30−05:00).
- Sunrise, sunset, and solar calculations always use the IANA timezone; the
  `solarCalc` library (or equivalent) must accept an IANA name, not a fixed
  offset.

---

## Midnight-crossing windows

A three-hour candidate session window may cross midnight in local time. Rules:

- Windows are identified by their **UTC start and end instants**, not by local
  time.
- A window crossing midnight in local time is valid if:
  1. The window starts and ends within the same local calendar day **or** within
     the forecast horizon (up to 7 days for NWS).
  2. All hard constraints (daylight, low-tide inclusion) are satisfied over the
     full window using UTC instants.
- A local date is associated with a window by the date of its **low-tide
  inclusion point** in the spot timezone.

---

## 15-minute timeline

The canonical timeline divides each UTC day into 96 equal 15-minute slots.

| Convention     | Value                                                          |
| -------------- | -------------------------------------------------------------- |
| Slot width     | 15 minutes (PT15M)                                             |
| Slot start     | Inclusive (a slot owns its start instant)                      |
| Slot end       | Exclusive (= next slot's start)                                |
| Alignment      | Aligned to UTC hour boundaries (00:00, 00:15, 00:30, 00:45, …) |
| Representation | ISO 8601 timestamp of the slot's start instant                 |

Example: slot `"2026-07-26T18:00:00+00:00"` covers the period
`[18:00:00, 18:15:00)` UTC on 2026-07-26.

---

## Interval boundaries (inclusive/exclusive)

All intervals in this project use the **half-open convention**:

```
[startInclusive, endExclusive)
```

- A three-hour session window `[09:00, 12:00)` contains slots starting at
  09:00, 09:15, …, 11:45. It does **not** contain a slot starting at 12:00.
- A low-tide time of 10:47 is **included** in the window `[09:00, 12:00)`.
- A sunrise of 05:28 is **not** included in a window `[05:30, 08:30)`.

---

## Provider unit conversion reference

| Source        | Field            | Source unit     | Canonical unit | Conversion factor          |
| ------------- | ---------------- | --------------- | -------------- | -------------------------- |
| NWS grid data | windSpeed        | km/h            | knots          | ÷ 1.852                    |
| NWS grid data | windGust         | km/h            | knots          | ÷ 1.852                    |
| NWS grid data | windDirection    | degrees true    | degrees true   | none (already degrees)     |
| NWS hourly    | windSpeed string | mph             | knots          | × 0.868976                 |
| NWS grid data | temperature      | °C              | °C             | none                       |
| NOAA CO-OPS   | tideHeight       | feet (english)  | feet           | none                       |
| NOAA CO-OPS   | tideHeight       | meters (metric) | feet           | × 3.28084 (if metric used) |
