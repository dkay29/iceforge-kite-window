# API Contract

Base path: `/v1`

## Forecast endpoints

```http
GET /spots
GET /spots/{spotId}
GET /spots/{spotId}/forecast?date=YYYY-MM-DD&personalized=true
GET /spots/{spotId}/outlook?days=7
```

## User endpoints

```http
GET /me/preferences
PUT /me/preferences
PUT /me/devices/{deviceId}
DELETE /me/devices/{deviceId}
```

## Forecast response behavior

```http
Cache-Control: public, max-age=300, stale-while-revalidate=900
ETag: "forecast-revision"
Last-Modified: Fri, 17 Jul 2026 22:02:14 GMT
X-Forecast-Generated-At: 2026-07-17T22:02:14Z
X-Forecast-Expires-At: 2026-07-17T23:15:00Z
```

Clients should send `If-None-Match`; the API may return `304 Not Modified`.

## Standard error

```json
{
  "error": {
    "code": "FORECAST_NOT_AVAILABLE",
    "message": "A forecast is not yet available for the requested date.",
    "requestId": "request-id",
    "retryable": true
  }
}
```
