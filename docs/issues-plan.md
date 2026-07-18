# GitHub Issue Implementation Plan

The repository includes 22 issue drafts in [`github-issues/`](../github-issues/). They are designed for import using the GitHub CLI script:

```bash
./tools/create-github-issues.sh
```

## Delivery phases

### Phase 1 — Foundation

- #1 Bootstrap monorepo
- #2 Canonical domain model
- #3 AWS CDK foundation
- #4 West Dennis configuration

### Phase 2 — Forecast acquisition and engine

- #5 NWS adapter
- #6 NOAA tide adapter
- #7 Solar calculation
- #8 Timeline normalizer
- #9 Direction classifier
- #10 Candidate-window generator
- #11 Suitability scoring
- #12 S3 publisher

### Phase 3 — API, identity, and notifications

- #13 Forecast API
- #14 Cognito and user preferences
- #15 Push notifications

### Phase 4 — Mobile experience

- #16 React Native shell
- #17 Conditions graph
- #18 Today screen
- #19 Settings and kite inventory

### Phase 5 — Operability and release

- #20 Observability and runbooks
- #21 End-to-end acceptance tests
- #22 Beta release

## Suggested milestones

| Milestone | Issues | Outcome |
|---|---|---|
| M1 Design locked | 1–4 | Deployable skeleton and validated spot/rules configuration |
| M2 Decision engine | 5–12 | Published S3 forecast for West Dennis |
| M3 Service beta | 13–15 | Authenticated API and notifications |
| M4 Mobile beta | 16–19 | Complete iOS/Android user experience |
| M5 Private release | 20–22 | Operationally supported private beta |
