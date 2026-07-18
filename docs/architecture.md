# Architecture

```mermaid
flowchart TD
    APP[React Native iOS and Android] -->|Cognito JWT / HTTPS| API[API Gateway HTTP API]
    API --> FAPI[Forecast API Lambda]
    API --> UAPI[User API Lambda]
    FAPI --> S3[(S3 keyed object store)]
    UAPI --> S3

    EV[EventBridge Scheduler] --> PIPE[Forecast Pipeline Lambda]
    PIPE --> NWS[NWS API]
    PIPE --> NOAA[NOAA CO-OPS API]
    PIPE --> SOLAR[Sunrise/Sunset Calculator]
    PIPE --> S3
    PIPE --> ALERT[Notification Evaluator]
    ALERT --> PUSH[AWS End User Messaging Push]
    PUSH --> APNS[APNs]
    PUSH --> FCM[FCM]
```

## Logical modules

- `weather-source`
- `tide-source`
- `solar-calculator`
- `normalizer`
- `direction-classifier`
- `window-generator`
- `suitability-scorer`
- `publisher`
- `forecast-api`
- `user-api`
- `notification-evaluator`

## Initial deployment units

For the MVP, source acquisition, normalization, scoring, and publishing may be one Lambda with clear internal module boundaries. Split only when retries, operational isolation, or independent scaling justify it.
