#!/usr/bin/env bash
set -Eeuo pipefail

# Creates or reuses the Phase 2 — AWS Integration issues and adds them to the
# existing Iceforge Kite Window GitHub Project roadmap.
#
# This script is intentionally separate from create-roadmap-project.sh:
# rerunning the original script would reset roadmap statuses for existing issues.
#
# Requirements:
#   - GitHub CLI (gh)
#   - jq
#   - Authenticated gh session with repo and project scopes
#
# Usage:
#   ./tools/create-phase2-aws-integration-issues.sh
#
# Optional overrides:
#   GH_OWNER=dkay229
#   GH_REPO=iceforge-kite-window
#   GH_PROJECT_NUMBER=4
#   PROJECT_TITLE="Iceforge Kite Window Roadmap"
#   START_STATUS=Ready
#
# Notes:
#   - Issue creation is idempotent by exact title.
#   - Existing issues are reused and are not reopened or edited.
#   - The first Phase 2 issue defaults to Ready; the rest default to Backlog.
#   - No AWS credentials are required. This script only uses GitHub.

OWNER="${GH_OWNER:-dkay229}"
REPO_NAME="${GH_REPO:-iceforge-kite-window}"
REPO="${OWNER}/${REPO_NAME}"
PROJECT_TITLE="${PROJECT_TITLE:-Iceforge Kite Window Roadmap}"
PROJECT_NUMBER="${GH_PROJECT_NUMBER:-}"
START_STATUS="${START_STATUS:-Ready}"

log()  { printf '\n==> %s\n' "$*"; }
warn() { printf '\nWARNING: %s\n' "$*" >&2; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    die "Required command not found: $1"
}

require_command gh
require_command jq

gh auth status >/dev/null 2>&1 ||
  die "GitHub CLI is not authenticated. Run: gh auth login"

gh repo view "$REPO" >/dev/null 2>&1 ||
  die "Repository not accessible: $REPO. Check GH_OWNER/GH_REPO and authentication."

if ! gh auth status 2>&1 | grep -Eq "project|read:project"; then
  warn "The current token may not have the project scope."
  warn "Run this if a project command fails: gh auth refresh -s project"
fi

case "$START_STATUS" in
  Backlog|Ready|"In Progress"|Blocked|Review|Done) ;;
  *)
    die "Unsupported START_STATUS '$START_STATUS'"
    ;;
esac

create_or_update_label() {
  local name="$1"
  local color="$2"
  local description="$3"

  gh label create "$name" \
    --repo "$REPO" \
    --color "$color" \
    --description "$description" \
    --force >/dev/null
}

log "Creating/updating Phase 2 labels"

create_or_update_label "infrastructure"          "BFD4F2" "AWS CDK and cloud infrastructure"
create_or_update_label "api"                     "0052CC" "Backend API contracts and implementation"
create_or_update_label "mobile"                  "C5DEF5" "React Native mobile application"
create_or_update_label "notifications"           "FBCA04" "Push notifications and device registration"
create_or_update_label "priority:p0"             "B60205" "Blocking or critical work"
create_or_update_label "priority:p1"             "D93F0B" "High-priority work"
create_or_update_label "priority:p2"             "FBCA04" "Normal-priority work"
create_or_update_label "phase:aws-integration"   "5319E7" "Phase 2 AWS integration and deployment"

find_project_number() {
  gh project list \
    --owner "$OWNER" \
    --limit 100 \
    --format json |
    jq -r --arg title "$PROJECT_TITLE" \
      '.projects[]? | select(.title == $title) | .number' |
    head -n 1
}

if [[ -z "$PROJECT_NUMBER" ]]; then
  PROJECT_NUMBER="$(find_project_number)"
fi

[[ -n "$PROJECT_NUMBER" ]] ||
  die "GitHub Project '$PROJECT_TITLE' was not found for owner '$OWNER'"

log "Repository: $REPO"
log "Project:    $PROJECT_TITLE (#$PROJECT_NUMBER)"

PROJECT_JSON="$(
  gh project view "$PROJECT_NUMBER" \
    --owner "$OWNER" \
    --format json
)"
PROJECT_ID="$(jq -r '.id' <<<"$PROJECT_JSON")"

project_fields_json() {
  gh project field-list "$PROJECT_NUMBER" \
    --owner "$OWNER" \
    --limit 100 \
    --format json
}

FIELDS_JSON="$(project_fields_json)"

field_id() {
  local field_name="$1"
  jq -r --arg name "$field_name" \
    '.fields[]? | select(.name == $name) | .id' <<<"$FIELDS_JSON" |
    head -n 1
}

option_id() {
  local field_name="$1"
  local option_name="$2"

  jq -r \
    --arg field "$field_name" \
    --arg option "$option_name" \
    '.fields[]?
     | select(.name == $field)
     | .options[]?
     | select(.name == $option)
     | .id' <<<"$FIELDS_JSON" |
    head -n 1
}

require_field_option() {
  local field_name="$1"
  local option_name="$2"

  [[ -n "$(field_id "$field_name")" ]] ||
    die "Project field '$field_name' was not found"

  [[ -n "$(option_id "$field_name" "$option_name")" ]] ||
    die "Option '$option_name' was not found in project field '$field_name'"
}

require_field_option "Roadmap Status" "Backlog"
require_field_option "Roadmap Status" "$START_STATUS"
require_field_option "Priority" "P0"
require_field_option "Priority" "P1"
require_field_option "Priority" "P2"
require_field_option "Workstream" "Infrastructure"
require_field_option "Workstream" "API"
require_field_option "Workstream" "Mobile"
require_field_option "Phase" "Post-MVP"
require_field_option "Risk" "Medium"
require_field_option "Risk" "High"

find_issue_json() {
  local title="$1"

  gh issue list \
    --repo "$REPO" \
    --state all \
    --limit 500 \
    --json number,title,url,state |
    jq -c --arg title "$title" \
      '.[] | select(.title == $title)' |
    head -n 1
}

ensure_issue() {
  local title="$1"
  local body="$2"
  local labels="$3"
  local existing issue_url

  existing="$(find_issue_json "$title")"

  if [[ -n "$existing" ]]; then
    printf '%s\n' "$existing"
    return
  fi

  log "Creating issue: $title" >&2

  issue_url="$(
    gh issue create \
      --repo "$REPO" \
      --title "$title" \
      --body "$body" \
      --label "$labels"
  )"

  gh issue view "$issue_url" \
    --repo "$REPO" \
    --json number,title,url,state
}

find_project_item_id() {
  local issue_url="$1"

  gh project item-list "$PROJECT_NUMBER" \
    --owner "$OWNER" \
    --limit 500 \
    --format json |
    jq -r --arg url "$issue_url" \
      '.items[]?
       | select(.content.url == $url)
       | .id' |
    head -n 1
}

ensure_project_item() {
  local issue_url="$1"
  local item_id

  item_id="$(find_project_item_id "$issue_url")"

  if [[ -z "$item_id" ]]; then
    item_id="$(
      gh project item-add "$PROJECT_NUMBER" \
        --owner "$OWNER" \
        --url "$issue_url" \
        --format json \
        --jq '.id'
    )"
  fi

  printf '%s\n' "$item_id"
}

set_single_select() {
  local item_id="$1"
  local field_name="$2"
  local value="$3"
  local fid oid

  fid="$(field_id "$field_name")"
  oid="$(option_id "$field_name" "$value")"

  [[ -n "$fid" && -n "$oid" ]] ||
    die "Unable to resolve '$field_name' option '$value'"

  gh project item-edit \
    --id "$item_id" \
    --project-id "$PROJECT_ID" \
    --field-id "$fid" \
    --single-select-option-id "$oid" >/dev/null
}

set_text() {
  local item_id="$1"
  local field_name="$2"
  local value="$3"
  local fid

  fid="$(field_id "$field_name")"
  [[ -n "$fid" ]] ||
    die "Unable to resolve text field '$field_name'"

  gh project item-edit \
    --id "$item_id" \
    --project-id "$PROJECT_ID" \
    --field-id "$fid" \
    --text "$value" >/dev/null
}

issue_body() {
  local outcome="$1"
  local acceptance="$2"
  local dependencies="$3"

  cat <<EOF
## Outcome

${outcome}

## Acceptance criteria

${acceptance}

## Dependencies

${dependencies}

---
Roadmap source: \`tools/create-phase2-aws-integration-issues.sh\`
EOF
}

# Fields:
# title | workstream | phase | priority | target release | dependencies |
# risk | labels | outcome | acceptance criteria
readarray -t PHASE2_ITEMS <<'EOF'
Define the AWS environment and deployment contract|Infrastructure|Post-MVP|P0|Phase 2|Phase 1 complete|High|infrastructure,priority:p0,phase:aws-integration|Define how Kite Window AWS environments are named, configured, synthesized, deployed, protected, and cost-controlled.|- Development and production environment conventions are documented.\n- The initial AWS region is explicitly selected.\n- Stack names, resource-name prefixes, and mandatory tags are defined.\n- Account and region values are supplied through CDK environment configuration rather than hard-coded application logic.\n- Removal policies are defined separately for development and production.\n- Expected monthly cost drivers and cost controls are documented.\n- Deployment requires an explicit AWS profile or CI role.\n- Local build, test, and CDK synth require no AWS credentials.\n- No AWS resources are deployed as part of this issue.
Implement the CDK storage and configuration foundation|Infrastructure|Post-MVP|P0|Phase 2|AWS environment and deployment contract|High|infrastructure,priority:p0,phase:aws-integration|Define the S3 infrastructure used for configuration, provider data, normalized timelines, published forecasts, preferences, and device records.|- CDK defines the required S3 bucket or buckets.\n- The bucket structure is compatible with the existing deterministic S3 key builders.\n- Public access is blocked.\n- Encryption, versioning, lifecycle rules, and retention policies are explicit.\n- Production buckets use a protective removal policy.\n- Development resources can be removed intentionally.\n- IAM access is granted through CDK grants rather than broad handwritten policies where practical.\n- CDK assertions verify security and lifecycle properties.\n- CDK synth succeeds without AWS credentials.\n- No deployment is required.
Package and define the forecast pipeline Lambda|Infrastructure|Post-MVP|P0|Phase 2|CDK storage and configuration foundation; Phase 1 pipeline components|High|infrastructure,priority:p0,phase:aws-integration|Connect the existing provider, normalization, decision, and publication components through a deployable Lambda entry point.|- A Lambda handler sequences spot configuration loading, NWS retrieval, NOAA retrieval, solar calculation, timeline normalization, candidate generation, hard-constraint evaluation, scoring, best-window selection, and forecast publication.\n- The handler uses the existing provider and storage interfaces.\n- Raw provider responses, normalized timelines, and published assessments use the existing key conventions.\n- Partial or failed runs never update the current pointer.\n- Correlation IDs propagate through the full execution.\n- Retries are safe and publication remains idempotent.\n- Lambda timeout, memory, concurrency, runtime, and environment variables are explicit.\n- Unit and integration tests use fixtures and in-memory storage.\n- CDK packages the Lambda successfully without AWS credentials.
Schedule forecast pipeline execution|Infrastructure|Post-MVP|P1|Phase 2|Forecast pipeline Lambda|Medium|infrastructure,priority:p1,phase:aws-integration|Invoke the forecast pipeline automatically using EventBridge Scheduler.|- CDK defines a schedule for forecast refreshes.\n- Schedule frequency and forecast horizon are documented.\n- The scheduler has only the permission required to invoke the pipeline.\n- Retry and dead-letter behavior are defined.\n- Concurrent or overlapping runs are handled safely.\n- A manual invocation mechanism is documented.\n- Scheduler resources can be disabled in a development environment.\n- CDK assertions verify the schedule, target, permissions, and failure handling.\n- No live invocation is required until an AWS environment is available.
Define and package the forecast API|API|Post-MVP|P0|Phase 2|CDK storage and configuration foundation; existing forecast API handlers|High|api,infrastructure,priority:p0,phase:aws-integration|Expose the existing spot and forecast handlers through API Gateway HTTP API and Lambda.|- CDK defines GET /v1/spots, GET /v1/spots/{spotId}, and GET /v1/spots/{spotId}/forecast routes plus any approved outlook endpoint.\n- Existing ETag, 304, cache-header, and structured-error behavior is preserved.\n- API Lambdas receive least-privilege read access to required S3 objects.\n- CORS settings are explicit and environment-specific.\n- Access logging and correlation IDs are enabled.\n- API and Lambda settings are covered by CDK assertions.\n- Handler tests continue to run without AWS.\n- An API URL is emitted as a stack output after deployment.
Define Cognito and authenticated user APIs|API|Post-MVP|P0|Phase 2|Forecast API; CDK storage foundation|High|api,infrastructure,priority:p0,phase:aws-integration|Provision Cognito authentication and expose authenticated preference and device endpoints.|- CDK defines a Cognito User Pool and mobile-compatible application client.\n- Authentication flow and password policy are documented.\n- API Gateway validates Cognito JWTs for protected routes.\n- Authenticated routes include GET /v1/me/preferences, PUT /v1/me/preferences, PUT /v1/me/devices/{deviceId}, and DELETE /v1/me/devices/{deviceId}.\n- User identity is derived from verified token claims rather than request-supplied user IDs.\n- Preference ETag conflict behavior is preserved.\n- User API Lambdas receive least-privilege access to corresponding S3 prefixes.\n- Cognito and API identifiers are emitted as deployment outputs.\n- Tests use representative claims and require no live User Pool.
Add AWS monitoring and operational controls|Infrastructure|Post-MVP|P1|Phase 2|Forecast pipeline; scheduled execution; APIs|Medium|infrastructure,priority:p1,phase:aws-integration|Make deployed scheduled and API execution diagnosable and safe to operate.|- Lambda log retention is explicit.\n- Structured logs preserve existing correlation IDs.\n- Metrics distinguish provider, pipeline, publication, API, authentication, and notification failures.\n- Alarms cover repeated pipeline failure, stale publication, Lambda errors, throttling, and dead-letter activity.\n- A basic CloudWatch dashboard shows current operational health.\n- Alarm destinations are configurable and optional in development.\n- Resource tags support project, environment, owner, and cost reporting.\n- CDK assertions cover critical alarms and retention settings.
Bootstrap and deploy the development AWS environment|Infrastructure|Post-MVP|P0|Phase 2|All offline Phase 2 infrastructure issues; explicit AWS access authorization|High|infrastructure,priority:p0,phase:aws-integration|Create the first real AWS development environment and validate the deployed backend.|- The selected AWS account, region, profile, and budget controls are confirmed before deployment.\n- The environment is bootstrapped with CDK bootstrap.\n- CDK diff is reviewed before deployment.\n- CDK stacks deploy successfully.\n- Stack outputs and generated mobile configuration are captured without committing secrets.\n- The scheduled pipeline completes against live NWS and NOAA sources.\n- Published S3 objects validate against the existing schemas.\n- Forecast API ETag and 304 behavior is validated against the live endpoint.\n- Cognito sign-in and authenticated preference operations are validated.\n- CloudWatch logs, metrics, and alarms are verified.\n- Deployment and teardown procedures are documented.
Connect the mobile application to the development environment|Mobile|Post-MVP|P1|Phase 2|Deployed development AWS environment; existing mobile implementation|High|mobile,priority:p1,phase:aws-integration|Replace the placeholder mobile integrations with deployable environment configuration.|- The forecast client calls the deployed API.\n- Amplify is configured from generated or environment-specific deployment outputs.\n- Cognito sign-in, sign-out, and session restoration work.\n- Authenticated preference updates preserve ETag conflict behavior.\n- Device registration uses the authenticated API.\n- No account identifiers, client secrets, tokens, or private endpoints are committed.\n- A fixture-backed local mode remains available without AWS access.\n- CI validates both fixture mode and production configuration shape.\n- The mobile application renders a live West Dennis forecast from the development backend.
EOF

log "Creating/reusing Phase 2 issues and adding them to the project"

first=true
created=0
reused=0

for row in "${PHASE2_ITEMS[@]}"; do
  IFS='|' read -r \
    title workstream phase priority target dependencies risk labels outcome acceptance <<<"$row"

  body="$(
    issue_body \
      "$outcome" \
      "$(printf '%b' "$acceptance")" \
      "$dependencies"
  )"

  existing_before="$(find_issue_json "$title")"
  issue_json="$(ensure_issue "$title" "$body" "$labels")"

  if [[ -n "$existing_before" ]]; then
    reused=$((reused + 1))
  else
    created=$((created + 1))
  fi

  issue_url="$(jq -r '.url' <<<"$issue_json")"
  issue_number="$(jq -r '.number' <<<"$issue_json")"
  item_id="$(ensure_project_item "$issue_url")"

  if $first; then
    roadmap_status="$START_STATUS"
    first=false
  else
    roadmap_status="Backlog"
  fi

  set_single_select "$item_id" "Roadmap Status" "$roadmap_status"
  set_single_select "$item_id" "Priority" "$priority"
  set_single_select "$item_id" "Workstream" "$workstream"
  set_single_select "$item_id" "Phase" "$phase"
  set_single_select "$item_id" "Risk" "$risk"
  set_text "$item_id" "Target release" "$target"
  set_text "$item_id" "Dependency" "$dependencies"

  printf '  #%s %s [%s]\n' "$issue_number" "$title" "$roadmap_status"
done

PROJECT_URL="$(
  gh project view "$PROJECT_NUMBER" \
    --owner "$OWNER" \
    --format json \
    --jq '.url'
)"

log "Phase 2 issue load complete"
printf '\nCreated: %s\n' "$created"
printf 'Reused:  %s\n' "$reused"
printf 'Project: %s\n' "$PROJECT_URL"
printf 'Repo:    https://github.com/%s\n' "$REPO"
