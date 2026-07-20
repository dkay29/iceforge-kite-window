# Implement device registration and push notifications

Labels: backend,mobile,notifications

## Goal

Notify users when a qualifying session appears or materially improves.

## Acceptance criteria

- iOS and Android device tokens are stored in S3.
- AWS End User Messaging Push integrates with APNs and FCM.
- Notification evaluator compares forecast revisions.
- Duplicate suppression and user thresholds are supported.
- Expired or invalid device tokens are disabled.

## Dependencies

#11, #14
