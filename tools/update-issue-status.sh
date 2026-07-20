#!/usr/bin/env bash
set -Eeuo pipefail

# Update the "Roadmap Status" field for a repository issue in the
# Iceforge Kite Window GitHub Project.
#
# Usage:
#   ./tools/update-issue-status.sh <issue-number> <status>
#
# Examples:
#   ./tools/update-issue-status.sh 1 "In Progress"
#   ./tools/update-issue-status.sh 1 Review
#   ./tools/update-issue-status.sh 1 Done
#
# Supported statuses:
#   Backlog
#   Ready
#   In Progress
#   Blocked
#   Review
#   Done
#
# Optional overrides:
#   GH_OWNER=dkay29
#   GH_REPO=iceforge-kite-window
#   GH_PROJECT_NUMBER=4
#   GH_PROJECT_FIELD="Roadmap Status"

OWNER="${GH_OWNER:-dkay29}"
REPO_NAME="${GH_REPO:-iceforge-kite-window}"
REPO="${OWNER}/${REPO_NAME}"
PROJECT_NUMBER="${GH_PROJECT_NUMBER:-4}"
STATUS_FIELD="${GH_PROJECT_FIELD:-Status}"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

usage() {
  cat <<'EOF'
Usage:
  update-issue-status.sh <issue-number> <status>

Statuses:
  Backlog
  Ready
  In Progress
  Blocked
  Review
  Done

Examples:
  update-issue-status.sh 1 "In Progress"
  update-issue-status.sh 1 Review
  update-issue-status.sh 1 Done
EOF
}

require_command gh
require_command jq

[[ $# -eq 2 ]] || {
  usage
  exit 2
}

ISSUE_NUMBER="$1"
REQUESTED_STATUS="$2"

[[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]] ||
  die "Issue number must be numeric: $ISSUE_NUMBER"

case "$REQUESTED_STATUS" in
  Backlog|Ready|"In Progress"|Blocked|Review|Done)
    ;;
  *)
    die "Unsupported status '$REQUESTED_STATUS'. Use: Backlog, Ready, In Progress, Blocked, Review, or Done."
    ;;
esac

gh auth status >/dev/null 2>&1 ||
  die "GitHub CLI is not authenticated. Run: gh auth login"

ISSUE_JSON="$(
  gh issue view "$ISSUE_NUMBER" \
    --repo "$REPO" \
    --json number,title,url,state
)" || die "Unable to read issue #$ISSUE_NUMBER from $REPO"

ISSUE_URL="$(jq -r '.url' <<<"$ISSUE_JSON")"
ISSUE_TITLE="$(jq -r '.title' <<<"$ISSUE_JSON")"

PROJECT_JSON="$(
  gh project view "$PROJECT_NUMBER" \
    --owner "$OWNER" \
    --format json
)" || die "Unable to access project #$PROJECT_NUMBER for owner $OWNER"

PROJECT_ID="$(jq -r '.id' <<<"$PROJECT_JSON")"

FIELDS_JSON="$(
  gh project field-list "$PROJECT_NUMBER" \
    --owner "$OWNER" \
    --limit 100 \
    --format json
)"

FIELD_ID="$(
  jq -r \
    --arg field "$STATUS_FIELD" \
    '.fields[]? | select(.name == $field) | .id' \
    <<<"$FIELDS_JSON" |
  head -n 1
)"

[[ -n "$FIELD_ID" ]] ||
  die "Project field '$STATUS_FIELD' was not found in project #$PROJECT_NUMBER"

OPTION_ID="$(
  jq -r \
    --arg field "$STATUS_FIELD" \
    --arg option "$REQUESTED_STATUS" \
    '.fields[]?
     | select(.name == $field)
     | .options[]?
     | select(.name == $option)
     | .id' \
    <<<"$FIELDS_JSON" |
  head -n 1
)"

[[ -n "$OPTION_ID" ]] ||
  die "Status option '$REQUESTED_STATUS' was not found in field '$STATUS_FIELD'"

ITEMS_JSON="$(
  gh project item-list "$PROJECT_NUMBER" \
    --owner "$OWNER" \
    --limit 500 \
    --format json
)"

ITEM_ID="$(
  jq -r \
    --arg url "$ISSUE_URL" \
    '.items[]?
     | select(.content.url == $url)
     | .id' \
    <<<"$ITEMS_JSON" |
  head -n 1
)"

if [[ -z "$ITEM_ID" ]]; then
  printf 'Issue #%s is not currently in project #%s; adding it.\n' \
    "$ISSUE_NUMBER" "$PROJECT_NUMBER"

  ITEM_ID="$(
    gh project item-add "$PROJECT_NUMBER" \
      --owner "$OWNER" \
      --url "$ISSUE_URL" \
      --format json \
      --jq '.id'
  )"
fi

gh project item-edit \
  --id "$ITEM_ID" \
  --project-id "$PROJECT_ID" \
  --field-id "$FIELD_ID" \
  --single-select-option-id "$OPTION_ID" >/dev/null

printf 'Updated issue #%s "%s" to "%s" in project #%s.\n' \
  "$ISSUE_NUMBER" "$ISSUE_TITLE" "$REQUESTED_STATUS" "$PROJECT_NUMBER"
