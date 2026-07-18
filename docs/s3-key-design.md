# S3 Key Design

```text
config/spots/{spotId}/current.json
config/spots/{spotId}/versions/{version}.json
config/rulesets/{rulesetId}/current.json
config/rulesets/{rulesetId}/versions/{version}.json

raw/weather/provider=nws/spot={spotId}/date={yyyy-mm-dd}/run={timestamp}.json
raw/tide/provider=noaa-coops/spot={spotId}/date={yyyy-mm-dd}/run={timestamp}.json

normalized/spot={spotId}/date={yyyy-mm-dd}/run={forecastRunId}.json
published/spot={spotId}/date={yyyy-mm-dd}/ruleset={rulesetId}/run={forecastRunId}.json

current/spot={spotId}/date={yyyy-mm-dd}/default.json
current/spot={spotId}/latest.json

users/{cognitoSub}/preferences.json
users/{cognitoSub}/devices/{deviceId}.json
```

## Rules

- Published forecast objects are immutable.
- `current` keys are small replaceable pointers or complete current documents.
- S3 versioning is enabled on configuration and user-data buckets.
- User writes use ETag optimistic concurrency.
- Raw source responses have lifecycle expiration.
