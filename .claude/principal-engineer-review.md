# Principal Engineer Review — Iceforge Kite Window

**Date:** 2026-07-27
**Reviewer:** Claude (principal engineer review)
**Scope:** Full repository — backend, mobile, infrastructure, schemas, documentation

---

## Summary

The domain logic is well-structured and thoughtfully implemented. The S3-first architecture is
consistently applied, the domain modules are clean, the data pipeline from NWS/NOAA through
normalization to window selection is complete, and the test coverage for individual domain
functions is strong. The repository is a credible foundation.

However, several structural gaps prevent the system from being deployed or used in any
environment. The infrastructure stack is empty, the pipeline has no Lambda entry point, the
mobile app is wired to placeholder stubs that always fail, the spot configuration is explicitly
marked inactive, and no ruleset document exists. These are not polish items — they are blockers
for M1 and M2 milestones.

---

## P0 — Must fix before first release

These items prevent the system from working in any deployed state.

---

### P0-1: Infrastructure stack is empty — nothing can be deployed

**File:** `infrastructure/lib/foundation-stack.ts`

`FoundationStack` contains zero CDK constructs. No S3 bucket, no Lambda, no API Gateway, no
Cognito User Pool, no EventBridge Scheduler, no IAM, no KMS. `cdk synth` passes CI green
because it synthesises an empty CloudFormation template.

The issues plan designates issue #3 (AWS CDK foundation) as Phase 1. Until that issue is
implemented, every deployment-related claim in the roadmap is unvalidated.

**Risk:** CI green on `synth` creates false confidence. Every subsequent phase (APIs, Lambda
deployment, scheduler) depends on resources that do not yet exist as CDK constructs.

---

### P0-2: No Lambda entry point for the forecast pipeline

The domain modules (`normalizer`, `windowSelector`, `scorer`, `hardRules`, `forecastBuilder`,
`publisher`) are all complete and tested. There is no Lambda handler that orchestrates them.

The pipeline sequence documented in the architecture:

```
fetch NWS → fetch NOAA → normalize → select windows → build forecast → publish to S3
```

has no deployed trigger, no Lambda function, and no EventBridge Scheduler rule. `readiness.ts`
is a 5-line stub (`return 'ready'`) with no HTTP route attached to it.

**Risk:** The decision engine is tested in isolation but has never run end to end. Integration
bugs (data format mismatch at seams, error propagation, scheduling) will not be caught until
the orchestrator is written.

---

### P0-3: `publisher.ts` does not write the normalized timeline

**File:** `backend/src/publisher.ts`

The module header comment says:

```
Publication protocol:
1. Write the immutable published forecast object
2. Write the normalized timeline object (also immutable, same guard)
3. Verify the published object is readable.
4. Update the daily current pointer.
5. Update the latest current pointer.
```

Step 2 is not implemented. The function goes directly from the published forecast write to
verification. `normalizedTimelineKey` is exported from `s3Keys.ts` and exists in the design
but is never imported or called by `publisher.ts`.

**Impact:** Normalized timelines are never persisted. Replay, debugging, and any future
`GET /spots/{id}/timeline` endpoint depend on this object existing in S3.

---

### P0-4: West Dennis spot config is inactive with no validated ruleset

**File:** `backend/src/config/spots/west-dennis-beach-ma.json`

```json
"active": false,
"validationStatus": "PARTIALLY_VALIDATED"
```

The shore bearing (195°) is documented as a geographic estimate not verified against NOAA
Chart 13229. The spot cannot be used in production until the bearing is surveyed and the
config is set to `active: true` with `validationStatus: "VALIDATED"`.

Additionally, there is no `defaultRulesetId` field in the spot config and no ruleset JSON
document exists anywhere in the repository (no `backend/src/config/rulesets/` directory).
The pipeline cannot score any window without a validated ruleset.

---

### P0-5: Mobile HTTP client is a placeholder that always returns 404

**File:** `mobile/src/screens/TodayScreen.tsx:46–50`

```typescript
function makePlaceholderHttpClient(): ForecastHttpClient {
  return {
    get: async () => ({ status: 404, body: {}, headers: {} }),
  };
}
```

The comment says "replaced with Amplify REST in issue #29" but this was not done. The mobile
app will always show "Forecast not available" regardless of what is in S3.

---

### P0-6: Amplify auth adapter is fully stubbed — authentication is impossible

**File:** `mobile/src/auth/amplifyAdapter.ts`

- `getCurrentUser()` always returns `null` — app starts signed out and cannot recover.
- `signIn()` always throws with a configuration error.
- `signOut()` always throws with a configuration error.

**File:** `mobile/src/config/amplify.ts:54–65`

```typescript
userPoolId: 'UNSET_USER_POOL_ID',
userPoolClientId: 'UNSET_CLIENT_ID',
endpoint: 'https://UNSET.execute-api.us-east-1.amazonaws.com/v1',
```

No tooling exists yet to inject real values from CDK deployment outputs (`inject-mobile-config.sh`
is referenced but not present). Authentication is a hard dependency for preferences and device
registration.

---

## P1 — Should fix before M3 (Service Beta)

These items are not immediate blockers but will cause correctness bugs, operational confusion,
or maintenance failures before or during M3.

---

### P1-1: Wind unit inconsistency between backend ruleset (mph) and mobile preferences (knots)

**Files:** `schemas/ruleset.schema.json`, `schemas/user-preferences.schema.json`

The backend `SuitabilityRuleset` defines thresholds in mph:

```json
"minimumUsableMph": 12,
"absoluteMaximumMph": 30,
"gustMaximumMph": 35
```

The mobile `UserPreferences` defines thresholds in knots:

```json
"minimumUsableKnots": 10,
"preferredMinKnots": 14
```

These are two different unit systems representing the same physical wind speed with no
conversion bridge or shared source of truth. The Settings screen will display knot values
while the engine scores against mph thresholds. Users will be confused when a 12-knot day
(acceptable per their preferences) receives NO_GO because the ruleset `minimumUsableMph`
is 12 mph ≈ 10.4 knots.

The canonical approach is to pick one unit system for the API contract and convert at the
boundary. MPH is an unusual choice for a kite-surfing app (knots is the aviation and maritime
standard). If mph is intentional, the Settings UI must display mph and label it explicitly.

---

### P1-2: S3 data cast without runtime validation in `forecastHandler.ts`

**File:** `backend/src/handlers/forecastHandler.ts:106,128`

```typescript
const pointer = rawPointer as CurrentPointer; // no validation
const forecast = rawForecast as PublishedSpotForecast; // no validation
```

Both S3 reads return `unknown`, which is then cast directly without AJV schema validation.
If S3 contains a migrated, corrupted, or partially-written document, the handler will either
crash with a confusing TypeError or silently serve a malformed response to the client.

`preferencesHandler.ts` has the same pattern. The convention should be to validate at the
S3 boundary before trusting the shape.

---

### P1-3: `KNOTS_TO_MPH` constant duplicated in two files

**Files:** `backend/src/domain/scorer.ts:25`, `backend/src/domain/windowSelector.ts:306`

```typescript
// scorer.ts — module-level constant
const KNOTS_TO_MPH = 1 / 0.868976;

// windowSelector.ts — inside buildReasons() function body
const KNOTS_TO_MPH = 1 / 0.868976;
```

Same constant, same value, two definitions. If the conversion factor ever needs to change
(it shouldn't, but the duplication is the risk), one site will be missed.

**Fix:** Export from a shared `units.ts` constants file.

---

### P1-4: Metric name collision — `forecast_served` means two different things

**Files:** `backend/src/handlers/forecastHandler.ts:137`, `backend/src/notifications/notificationDispatcher.ts:121`

`forecastHandler.ts`:

```typescript
recordMetric(spotLog, 'forecast_served', 1, { spotId, localDate: date });
// meaning: "one HTTP forecast response delivered to a client"
```

`notificationDispatcher.ts`:

```typescript
recordMetric(log, 'forecast_served', result.sent);
// meaning: "N push notifications sent for this forecast run"
```

Both streams are written to the same metric name. In CloudWatch, these will be aggregated
together. Dashboards and alarms built on `forecast_served` will be measuring an incoherent
sum of HTTP responses and push deliveries.

The notification metric should be named `notifications_sent` or `push_delivered`.

---

### P1-5: `normalizer.ts` `buildSources()` always writes `isStale: false`

**File:** `backend/src/domain/normalizer.ts:274,284`

```typescript
// NWS source record
isStale: false, // caller decides staleness; we report based on field

// NOAA source record
isStale: false,
```

The function computes `nwsIsStale` and `tideIsStale` booleans earlier and uses them to
penalise confidence scores, but it does not write them to the persisted source record. The
`SourceRecord` in the normalized timeline will never show `isStale: true` even for a 3-hour-old
NWS fetch.

The comment "caller decides staleness" is misleading — the caller (`normalizeTimeline`) is
the function that has the staleness information. This is where it should be written.

---

### P1-6: `DeviceStore.listKeys` and `FanOutStore.listPage` duplicate the S3 list interface

**Files:** `backend/src/handlers/deviceHandler.ts`, `backend/src/fanOut/fanOutService.ts`

```typescript
// deviceHandler.ts
interface DeviceStore {
  listKeys(prefix: string): Promise<string[]>; // all at once
}

// fanOutService.ts
interface FanOutStore {
  listPage(prefix: string, continuationToken?: string): Promise<ListPage>; // paginated
}
```

A real S3 adapter must implement both interfaces with different signatures for the same
underlying operation. The `listKeys` interface is unsafe for large user bases (it loads all
device keys into memory at once), and it duplicates the paginated design already built in
`FanOutStore`.

`DeviceStore.listKeys` should be replaced with `FanOutStore.listPage` so a single concrete
S3 adapter satisfies both callers.

---

### P1-7: `forecastHandler.ts` conflates correlation ID and request ID

**File:** `backend/src/handlers/forecastHandler.ts:64–66,86`

```typescript
const requestId = event.requestContext?.requestId ?? 'unknown';
const correlationId = resolveCorrelationId(event.headers, requestId);
// ...
const requestId = correlationId; // shadow at line 86
```

Line 86 shadows the outer `requestId` with `correlationId`. The `X-Request-Id` and
`X-Correlation-Id` response headers then both contain the correlation ID. API Gateway
request IDs (scoped to one invocation) and correlation IDs (propagated across service
boundaries) are distinct concepts and should not be conflated. Downstream log correlation
will be ambiguous.

---

### P1-8: Mobile `forecastService.ts` manually duplicates all backend schema types

**File:** `mobile/src/services/forecastService.ts:10–71`

`RecommendationStatus`, `WindClassification`, `TimelinePoint`, `SessionWindow`, `DaylightInfo`,
`TideEvent`, and `SpotForecast` are all manually re-declared in the mobile service file. They
are not generated from `schemas/published-forecast.schema.json`.

When the backend schema is updated (new field, renamed status, etc.), the mobile types must
be updated by hand. The schema toolchain (`generate-types.mjs`) already supports multi-package
generation. The mobile package should consume generated types.

---

## P2 — Future improvements

These items are low-urgency but should be addressed before the M5 private release.

---

### P2-1: `localMidnightToUtcMs` brute-force timezone probe

**File:** `backend/src/domain/normalizer.ts:202`

Scans ±1,680 minutes in 1-minute steps, calling `Intl.DateTimeFormat.formatToParts` 1,680
times per invocation. A bisection search would converge in ~11 calls. At current scale
(one spot, hourly refresh) this is not a problem, but it adds ~50–100 ms of unnecessary
computation per pipeline run when more spots are added.

---

### P2-2: `Math.max(...heights, 1)` spread in `ForecastTimeline.tsx`

**File:** `mobile/src/components/ForecastTimeline.tsx:148`

```typescript
return Math.max(...heights, 1);
```

`Math.max` with spread pushes all values onto the call stack. For 96-point timelines this is
safe, but the pattern is fragile if the timeline ever grows. `heights.reduce((a, b) => Math.max(a, b), 1)` is both correct and unbounded.

---

### P2-3: Wind direction arrows not rendered in `ForecastTimeline`

**File:** `mobile/src/components/ForecastTimeline.tsx`

The component header comment describes "Wind direction arrows drawn above the wind bars at
30-min intervals." `WindTrack` renders only bars. The `windDirectionDegrees` field is present
in `TimelinePoint` but unused in the render. The initial design mockup requires direction
arrows; this is listed as a missing feature, not a bug.

---

### P2-4: `FreshnessBar` `isOffline` prop is never passed in `TodayScreen`

**File:** `mobile/src/screens/TodayScreen.tsx`

```typescript
<FreshnessBar generatedAt={forecast.generatedAt} expiresAt={forecast.expiresAt} />
```

`isOffline` is absent. No network connectivity detection exists anywhere in the app. The
"Offline" freshness state and the airplane icon will never appear in production.

---

### P2-5: `STATUS_COLORS` duplicated in `TodayScreen.tsx` and `ForecastTimeline.tsx`

Both files independently define:

```typescript
const STATUS_COLORS = { GO: '#34C759', MARGINAL: '#FF9500', NO_GO: '#FF3B30', ... };
```

If the GO color changes, one file will be missed. Extract to a shared design-tokens file.

---

### P2-6: No error boundary in the React Native app

Uncaught render exceptions in React Native produce a blank white screen in production builds
with no user-visible message. An `ErrorBoundary` wrapping the navigator would allow a
graceful fallback and recovery option.

---

### P2-7: `readiness.ts` health check is not wired to any endpoint

**File:** `backend/src/readiness.ts`

```typescript
export function getReadinessStatus(): ReadinessStatus {
  return 'ready';
}
```

This function has no Lambda handler, no API Gateway route, and no CDK wiring. No health
check endpoint exists. ALB and Route 53 health checks will have nothing to probe.

---

### P2-8: CDK synth passes green on an empty template

`npm run synth` validates that the CDK app compiles but the synthesised output is an empty
CloudFormation template. CI green on this check gives false confidence that the infrastructure
is valid. The check becomes meaningful only once P0-1 is addressed and real resources are
defined.

---

### P2-9: `conservativeHazardInterpolate` appears to be dead code

**File:** `backend/src/domain/interpolation.ts:83`

Defined but not called by `normalizer.ts`, which uses constant interval lookup for all fields
including `probabilityOfThunder`. If this function is genuinely unused, it should be removed
to avoid confusion. If it is intended for a future interpolation path, that should be
documented.

---

### P2-10: No `GET /spots` or spot discovery endpoint

`TodayScreen.tsx` hardcodes `const SPOT_ID = 'west-dennis-beach-ma'`. Adding a second spot
requires a code change in the mobile app. A `GET /spots` endpoint is needed before the
private beta can serve more than one location.

---

### P2-11: Solar algorithm uses noon UTC, not local solar noon

**File:** `backend/src/domain/solar.ts:51`

```typescript
const noonUtcMs = midnightUtcMs + 12 * 60 * 60 * 1000;
```

The Julian century is computed at 12:00 UTC. For West Dennis (UTC−4 in summer), this is
08:00 local time — four hours before local solar noon. The resulting sunrise/sunset error
is ±1–2 minutes at this latitude, which is acceptable for the use case. This approximation
should be documented as a known limitation so future contributors do not treat it as a bug.

---

## Test coverage gaps

The following scenarios are required by CLAUDE.md but coverage is absent or unclear:

| Scenario                                                                    | Status                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `normalizeTimeline` full end-to-end with stale NWS data                     | Not found — `normalizer.test.ts` exists but tests clean data |
| `publisher.ts` normalized timeline write (P0-3)                             | Cannot be tested — code path does not exist                  |
| `deviceHandler.ts` concurrent PUT (race condition on `registeredAt`)        | Not tested                                                   |
| `fanOutService.ts` with real paginated S3 responses (>1 page)               | Covered with 3-page mock                                     |
| `notificationDispatcher.ts` marker write failure (Lambda killed mid-flight) | Not tested — at-least-once semantics, acceptable             |
| `interpolateScalar` with exactly-at-boundary gap (`gap === maxGapMs`)       | Not found                                                    |
| Solar events at civil twilight exactly on a slot boundary                   | Not found                                                    |

---

## Architecture conformance

The implementation is faithful to the S3-first architecture. No DynamoDB has been introduced.
Provider interfaces are properly isolated behind adapters. The mobile app does not reconstruct
decision logic. Published forecasts are immutable with stable current pointers. ETags are
used for conditional HTTP requests. The observability pattern (structured logger +
`recordMetric`) is consistent across handlers.

The one architectural deviation is P0-3 (normalized timeline not written), which is an
omission rather than a substitution.

---

## Recommended action order

1. **P0-4 + P0-4 (ruleset):** Create the west-dennis ruleset document and activate the spot config — prerequisite for any pipeline test.
2. **P0-2:** Write the forecast pipeline Lambda orchestrator — the core deliverable of M2.
3. **P0-1:** Implement the CDK foundation stack (issue #3) — required before any deployment.
4. **P0-3:** Add normalized timeline write to `publisher.ts` — one missing `putJson` call.
5. **P1-4:** Rename the notification metric to avoid collision with the HTTP metric.
6. **P1-5:** Fix `isStale` field in `buildSources()`.
7. **P0-5 + P0-6:** Wire Amplify REST client and real Cognito — prerequisite for M3.
8. **P1-1:** Resolve wind unit system (mph vs knots) across the API boundary.
9. **P1-2:** Add AJV validation at S3 read boundaries in handlers.
10. Remaining P1 items in priority order.
