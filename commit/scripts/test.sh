#!/usr/bin/env bash
# Self-check for the commit skill scripts. Prints "PASS" or the first failure.
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/commit-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

# check-message: subjects over 72 chars fail, with or without --no-type.
printf '%s\n' "$(printf 'x%.0s' {1..80})" >"$tmp/long"
if bash "$dir/check-message.sh" "$tmp/long" --no-type >/dev/null 2>&1; then
  fail "check-message accepted an 80-char subject with --no-type"
fi
printf 'feat: add x\n' >"$tmp/ok"
bash "$dir/check-message.sh" "$tmp/ok" >/dev/null || fail "check-message rejected a valid subject"

# check-message: ticket prefixes are allowed before the type, or alone with --no-type.
printf 'MYSECURITY-1629: fix(status): make link real\n' >"$tmp/ticket"
bash "$dir/check-message.sh" "$tmp/ticket" >/dev/null || fail "check-message rejected a ticket-prefixed subject"
printf 'MYSECURITY-1547/1548: Address review findings\n' >"$tmp/ticket2"
bash "$dir/check-message.sh" "$tmp/ticket2" --no-type >/dev/null || fail "check-message rejected a multi-ticket subject"

# reflow: bullets wrap with a two-space indent; trailers stay on their own lines.
printf 'feat: x\n\n- %s\n\nwhy.\n\nRefs: #1\nCloses: #2\n' \
  "one two three four five six seven eight nine ten eleven twelve thirteen" >"$tmp/msg"
out="$(bash "$dir/reflow-message.sh" "$tmp/msg" 30)"
expected='feat: x

- one two three four five six
  seven eight nine ten eleven
  twelve thirteen

why.

Refs: #1
Closes: #2'
[ "$out" = "$expected" ] || fail "reflow output:
$out"

# git-context: works in a repo with no commits.
git init -q "$tmp/repo"
echo hi >"$tmp/repo/a"
(cd "$tmp/repo" && bash "$dir/git-context.sh" >/dev/null) || fail "git-context failed on an unborn branch"

echo PASS
