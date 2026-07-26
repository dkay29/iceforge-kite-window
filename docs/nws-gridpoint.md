# NWS Grid Point and Forecast Endpoints: West Dennis Beach (Issue #4)

This document records the National Weather Service grid-point metadata resolved
for West Dennis Beach, the endpoint URLs captured for the NWS provider adapter,
and key findings about the data format.

## Resolved grid point

| Field             | Value                                                        |
| ----------------- | ------------------------------------------------------------ |
| Office (CWA)      | **BOX** — National Weather Service Boston/Norton, MA         |
| Grid X            | **107**                                                      |
| Grid Y            | **74**                                                       |
| Point type        | **marine**                                                   |
| Forecast zone     | **ANZ232** (Nantucket Sound)                                 |
| Radar station     | **KBOX**                                                     |
| Relative location | West Dennis, MA (distance: 0 — spot is within the grid cell) |

### Resolution method

The NWS Points API was queried on 2026-07-26:

```
GET https://api.weather.gov/points/41.6494,-70.1845
User-Agent: iceforge-kite-window/0.1 (contact@iceforge.io)
```

The response confirmed the spot coordinates fall within grid cell BOX/107,74.

## Confirmed endpoints

| Endpoint             | URL                                                             |
| -------------------- | --------------------------------------------------------------- |
| Points metadata      | `https://api.weather.gov/points/41.6494,-70.1845`               |
| Hourly forecast      | `https://api.weather.gov/gridpoints/BOX/107,74/forecast/hourly` |
| 12-hourly forecast   | `https://api.weather.gov/gridpoints/BOX/107,74/forecast`        |
| Grid data            | `https://api.weather.gov/gridpoints/BOX/107,74`                 |
| Observation stations | `https://api.weather.gov/gridpoints/BOX/107,74/stations`        |

All endpoints were confirmed reachable on 2026-07-26.

## Point type: marine

The NWS classifies this grid cell as `type: "marine"`. The spot sits on
Nantucket Sound (forecast zone ANZ232), which is a marine zone under the
jurisdiction of BOX. The NWS marine forecast uses the same grid data
infrastructure as land forecasts, but:

- Marine zone identifiers use the `ANZ` prefix.
- Some land-specific fields (e.g. `hainesIndex`, `snowLevel`) may have zero
  values or be absent for marine cells.
- Wave fields (`waveHeight`, `wavePeriod`, `windWaveHeight`) are populated for
  marine cells.

The NWS adapter must send a `User-Agent` header on all requests; the API returns
`403` without it.

## Key data format findings

These findings affect the NWS provider adapter implementation (later issue):

### Grid data endpoint (preferred for decision engine)

The grid data endpoint (`/gridpoints/BOX/107,74`) provides:

| Field                        | Unit                     | Notes                                                        |
| ---------------------------- | ------------------------ | ------------------------------------------------------------ |
| `windDirection`              | `wmoUnit:degree_(angle)` | Direction **in degrees** — no cardinal-string parsing needed |
| `windSpeed`                  | `wmoUnit:km_h-1`         | Must convert to knots or m/s for internal use                |
| `windGust`                   | `wmoUnit:km_h-1`         | Gust data confirmed available                                |
| `skyCover`                   | `wmoUnit:percent`        | Cloud cover                                                  |
| `probabilityOfPrecipitation` | `wmoUnit:percent`        | PoP                                                          |
| `probabilityOfThunder`       | (unitless)               | Thunderstorm probability                                     |
| `waveHeight`                 | `wmoUnit:m`              | Marine grid — wave height available                          |

Values are encoded as ISO 8601 duration-keyed time series:

```json
{
  "uom": "wmoUnit:degree_(angle)",
  "values": [
    { "validTime": "2026-07-26T05:00:00+00:00/PT1H", "value": 45 },
    ...
  ]
}
```

The adapter must parse ISO 8601 durations to expand each interval into the
15-minute timeline.

### Hourly forecast endpoint (secondary)

The hourly forecast (`/gridpoints/BOX/107,74/forecast/hourly`) provides:

- `windSpeed` as a **string** (e.g. `"10 mph"`) — requires parsing
- `windDirection` as a **cardinal string** (e.g. `"NE"`) — requires conversion to degrees
- No gust field in the hourly response

**Recommendation:** Use the grid data endpoint as the primary wind data source.
The hourly forecast endpoint is useful for `shortForecast` and `icon` fields
but is not the preferred source for numeric wind and gust values.

### Attribution

NWS data is in the public domain. The required attribution per NWS terms of
service:

> National Weather Service, Boston/Norton MA (BOX)

This is recorded in `sources.nwsGridpoint.attribution` in the spot configuration.

## Captured fixtures

| Fixture file                                                                  | Contents                               |
| ----------------------------------------------------------------------------- | -------------------------------------- |
| `backend/src/providers/nws/fixtures/points-41.6494--70.1845-20260726.json`    | Full Points API response               |
| `backend/src/providers/nws/fixtures/forecast-hourly-BOX-107-74-20260726.json` | Hourly forecast, first 6 periods       |
| `backend/src/providers/nws/fixtures/griddata-BOX-107-74-20260726.json`        | Grid data, 8 key fields, 3 values each |

## Out of scope for issue #4

- NWS provider adapter implementation (later issue)
- ISO 8601 duration parsing
- Wind unit conversion
- Timeline normalization
- Observation station selection (nearest ASOS/AWOS for surface observations)
