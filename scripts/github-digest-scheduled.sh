#!/usr/bin/env bash
# github-digest-scheduled.sh
#
# Scheduled GitHub issues/PR digest wrapper.
#
# Behavior:
# - refreshes the normalized JSON + Markdown digest using the repo collator
# - maintains a rolling YAML history of per-repo issue/PR/star metrics
# - posts the Markdown digest when open issues/PRs exist or when stars changed
#
# The digest snapshot is written outside the repo by default:
#   /workspace/generated/github-collate/latest-open-all-repos.{json,md}
# The history file is written as:
#   /workspace/notes/reference/github-repo-metrics-history.yml

set -euo pipefail

ROOT_DIR="/workspace/piclaw"
COLLATE_SCRIPT="$ROOT_DIR/scripts/github-collate-issues-prs.ts"
OUTPUT_DIR="${PICLAW_GITHUB_COLLATE_OUTPUT_DIR:-/workspace/generated/github-collate}"
NOTES_DIR="/workspace/notes/reference"
LATEST_JSON="$OUTPUT_DIR/latest-open-all-repos.json"
LATEST_MD="$OUTPUT_DIR/latest-open-all-repos.md"
LATEST_HISTORY="$NOTES_DIR/github-repo-metrics-history.yml"
TARGET_CHAT_JID="${1:-${PICLAW_CHAT_JID:-web:chat:94b5b0fe-d4d6-4e37-b6fe-a73f0d8362ec}}"
PICLAW_BIN="${PICLAW_BIN:-/usr/local/bin/piclaw}"

if [[ ! -f "$COLLATE_SCRIPT" ]]; then
  echo "Missing collate script: $COLLATE_SCRIPT" >&2
  exit 1
fi

if [[ ! -x "$PICLAW_BIN" ]]; then
  printf '%s\n' "[github-digest] Piclaw CLI is not executable: $PICLAW_BIN" >&2
  exit 126
fi

mkdir -p "$OUTPUT_DIR" "$NOTES_DIR"

tmp_json="$(mktemp "$OUTPUT_DIR/latest-open-all-repos.XXXXXX.json")"
tmp_md="$(mktemp "$OUTPUT_DIR/latest-open-all-repos.XXXXXX.md")"
tmp_history="$(mktemp "$NOTES_DIR/github-repo-metrics-history.XXXXXX.yml")"
if [[ -f "$LATEST_HISTORY" ]]; then
  cp "$LATEST_HISTORY" "$tmp_history"
fi
cleanup() {
  rm -f "$tmp_json" "$tmp_md" "$tmp_history"
}
trap cleanup EXIT

# Prefer already-injected env vars. Mirror whichever token is present so both
# gh-based tooling and the Bun collator can see a standard name.
if [[ -n "${GH_TOKEN:-}" ]]; then
  export GITHUB_TOKEN="$GH_TOKEN"
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  export GH_TOKEN="$GITHUB_TOKEN"
elif [[ -n "${GITHUB_PICLAW_BOT_PAT:-}" ]]; then
  export GH_TOKEN="$GITHUB_PICLAW_BOT_PAT"
  export GITHUB_TOKEN="$GITHUB_PICLAW_BOT_PAT"
else
  gh_token="$(gh auth token 2>/dev/null || true)"
  if [[ -n "$gh_token" ]]; then
    export GH_TOKEN="$gh_token"
    export GITHUB_TOKEN="$gh_token"
  fi
fi

if [[ -z "${GH_TOKEN:-}" && -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Missing GitHub token. Expected GH_TOKEN, GITHUB_TOKEN, GITHUB_PICLAW_BOT_PAT, or persisted gh auth." >&2
  exit 1
fi

bun "$COLLATE_SCRIPT" \
  --state open \
  --active-within-hours 24 \
  --include-private \
  --output-json "$tmp_json" \
  --output-markdown "$tmp_md" \
  --history-yaml "$tmp_history" \
  >/dev/null

mv "$tmp_json" "$LATEST_JSON"
mv "$tmp_md" "$LATEST_MD"
mv "$tmp_history" "$LATEST_HISTORY"
chmod 0644 "$LATEST_JSON" "$LATEST_MD" "$LATEST_HISTORY"
trap - EXIT

total_items="$(jq -r '.totals.total_items // 0' "$LATEST_JSON")"
star_changes="$(jq -r '.totals.repos_with_star_changes // 0' "$LATEST_JSON")"

if [[ "$total_items" == "0" && "$star_changes" == "0" ]]; then
  # Scheduled shell stdout is persisted to the target chat. A successful
  # empty digest must therefore be completely silent.
  exit 0
fi

POST_CONTENT="$(cat "$LATEST_MD")"
tmp_post_stderr="$(mktemp "$OUTPUT_DIR/github-digest-post.XXXXXX.stderr")"
cleanup_post() {
  rm -f "$tmp_post_stderr"
}
trap cleanup_post EXIT

if "$PICLAW_BIN" --post "$TARGET_CHAT_JID" "$POST_CONTENT" >/dev/null 2>"$tmp_post_stderr"; then
  # CLI startup can emit structured compatibility warnings for deprecated env
  # aliases inherited by the scheduled task. They are not report output. Keep
  # every other diagnostic visible, and preserve the full stderr on failure.
  grep -Ev '"operation"[[:space:]]*:[[:space:]]*"domain_config\.compat_env"' "$tmp_post_stderr" >&2 || true
else
  post_status=$?
  cat "$tmp_post_stderr" >&2
  exit "$post_status"
fi

# Successful posting is also silent: the digest was already posted by the CLI,
# and emitting a status line would create a second scheduled-task message.
