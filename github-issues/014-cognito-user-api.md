# Implement Cognito authentication and S3-backed user preferences

Labels: backend,auth

## Goal
Support authenticated user preferences without DynamoDB.

## Acceptance criteria
- Cognito User Pool configured for Apple, Google, and optional email sign-in.
- Preferences are stored at `users/{sub}/preferences.json`.
- PUT uses ETag and If-Match optimistic concurrency.
- Authorization prevents cross-user access.
- Default preferences are created safely on first use.

## Dependencies
#3, #13
