#!/usr/bin/env bash
set -euo pipefail

# Requires GitHub CLI authentication and execution from the repository root.
for file in github-issues/[0-9][0-9][0-9]-*.md; do
  title=$(sed -n '1s/^# //p' "$file")
  labels=$(sed -n '3s/^Labels: //p' "$file")
  body=$(mktemp)
  tail -n +5 "$file" > "$body"
  args=(issue create --title "$title" --body-file "$body")
  IFS=',' read -ra label_array <<< "$labels"
  for label in "${label_array[@]}"; do
    label=$(echo "$label" | xargs)
    [[ -n "$label" ]] && args+=(--label "$label")
  done
  gh "${args[@]}"
  rm -f "$body"
done
