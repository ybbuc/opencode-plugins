#!/usr/bin/env bash
# Read-only working-tree context collector for writing a conventional commit message.
#
# Everything uncommitted is the subject: modified, deleted, and untracked files.
# The git index is deliberately ignored — staging is an implementation detail the
# caller performs right before committing. All paths are relative to the repo root.
#
# Usage: git-context.sh [--amend]
#   --amend  diff against HEAD's parent, i.e. what the amended commit will contain
# Env:
#   MAX_DIFF_BYTES       truncate the tracked diff above this size (default 120000)
#   UNTRACKED_PREVIEW    bytes of preview shown per untracked text file (default 4000)
#   MAX_PREVIEWS         untracked files previewed; the rest are listed by name (default 20)

set -euo pipefail

max_diff_bytes="${MAX_DIFF_BYTES:-120000}"
untracked_preview="${UNTRACKED_PREVIEW:-4000}"
max_previews="${MAX_PREVIEWS:-20}"
amend=0
[ "${1:-}" = "--amend" ] && amend=1

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: not inside a git working tree." >&2
  exit 1
fi

gitq() { git --no-pager "$@"; }

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
branch="$(git symbolic-ref --short -q HEAD || echo '(detached HEAD)')"
empty_tree="$(git hash-object -t tree /dev/null)"

if ! git rev-parse -q --verify HEAD >/dev/null; then
  base="$empty_tree"
  base_label="empty tree (no commits yet)"
elif [ "$amend" -eq 1 ]; then
  base="$(git rev-parse -q --verify HEAD~1 || echo "$empty_tree")"
  base_label="HEAD~1 (amending HEAD)"
else
  base="HEAD"
  base_label="HEAD"
fi

echo "== Repo root =="
echo "$repo_root"
echo
echo "== Branch =="
echo "$branch"
echo

echo "== Recent commit subjects (style reference) =="
gitq log -10 --pretty=format:'%h %s' 2>/dev/null || echo "(no commits yet)"
echo
echo

if [ "$amend" -eq 1 ]; then
  echo "== Commit being amended =="
  gitq log -1 --pretty=format:'%h %s%n%n%b' || true
  echo
fi

echo "== Working tree status =="
gitq status --short || true
echo

untracked="$(gitq ls-files --others --exclude-standard)"
secrets="$( { gitq diff "$base" --name-only; printf '%s\n' "$untracked"; } |
  grep -Ei '(^|/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?)$' || true)"
if [ -n "$secrets" ]; then
  echo "== WARNING: possible secret files — confirm before committing =="
  echo "$secrets"
  echo
fi

echo "== Changes vs $base_label (summary) =="
gitq diff "$base" --stat || true
echo

echo "== Changes vs $base_label (tracked) =="
diff_output="$(gitq diff "$base" || true)"
diff_bytes="${#diff_output}"
if [ "$diff_bytes" -gt "$max_diff_bytes" ]; then
  echo "NOTE: diff is ${diff_bytes} bytes; truncated to ${max_diff_bytes} bytes. See the summary above for every file."
  printf '%s' "${diff_output:0:$max_diff_bytes}"
  echo
  echo "... [diff truncated] ..."
else
  printf '%s\n' "$diff_output"
fi
echo

echo "== Untracked files =="
n=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  n=$((n + 1))
  echo "--- $f"
  # grep -I skips binary files; only preview text.
  if [ "$n" -le "$max_previews" ] && [ -f "$f" ] && grep -Iq . "$f" 2>/dev/null; then
    head -c "$untracked_preview" "$f" 2>/dev/null || true
    echo
  fi
done <<<"$untracked"
if [ "$n" -eq 0 ]; then
  echo "(none)"
elif [ "$n" -gt "$max_previews" ]; then
  echo "NOTE: ${n} untracked files; only the first ${max_previews} are previewed."
fi
