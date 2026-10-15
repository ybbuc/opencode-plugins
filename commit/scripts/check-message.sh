#!/usr/bin/env bash
# Validate a conventional commit message file.
#
# Usage: check-message.sh <file> [--no-type]
#   --no-type  skip the conventional type-prefix checks (for type=none messages)
# Exit 0 when valid; prints each problem and exits 1 otherwise.

set -euo pipefail

# Character-accurate length checks for non-ASCII text.
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

limit=72
no_type=0
file=""
for arg in "$@"; do
  case "$arg" in
    --no-type) no_type=1 ;;
    *) file="$arg" ;;
  esac
done

if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Usage: check-message.sh <file> [--no-type]" >&2
  exit 2
fi

subject="$(head -n 1 "$file")"
problems=0

fail() { echo "FAIL: $1"; problems=$((problems + 1)); }

# An optional ticket prefix ("ABC-123: ", "ABC-1/2/3: ") precedes everything else.
summary="$subject"
ticket_re='^[A-Z][A-Z0-9]*-[0-9]+(/[0-9]+)*: '
if [[ "$subject" =~ $ticket_re ]]; then
  summary="${subject#"${BASH_REMATCH[0]}"}"
  [ -z "$summary" ] && fail "nothing follows the ticket prefix"
fi

types='feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'

if [ "$no_type" -eq 0 ]; then
  if ! printf '%s' "$summary" | grep -Eq "^(${types})(\([^)]+\))?!?: .+"; then
    fail "subject must match '[TICKET-1: ]type(scope): summary' (types: ${types//|/, })"
  fi
fi

subj_len="${#subject}"
if [ "$subj_len" -eq 0 ]; then
  fail "subject line is empty"
elif [ "$subj_len" -gt "$limit" ]; then
  fail "subject is ${subj_len} chars; limit is ${limit}"
fi

case "$subject" in
  *.) fail "subject must not end with a period" ;;
esac

if [ "$no_type" -eq 0 ] && printf '%s' "$summary" | grep -Eq "^(${types})(\([^)]+\))?!?: [A-Z]"; then
  fail "summary should start lowercase after the colon"
fi

if grep -Eq '^```' "$file"; then
  fail "message must not contain markdown code fences"
fi

if grep -Eq '^[[:space:]]*\*[[:space:]]+' "$file"; then
  fail "use '-' for bullet points, not '*'"
fi

if grep -Eiq '^(summary|rationale|changes|description|why|context):' "$file"; then
  fail "remove section labels like 'Summary:' or 'Rationale:'"
fi

body_lines="$(tail -n +2 "$file" | sed '/^[[:space:]]*$/d' | wc -l | tr -d ' ')"
if [ "$body_lines" -gt 0 ]; then
  second="$(sed -n '2p' "$file")"
  if [ -n "$second" ]; then
    fail "put a blank line between the subject and the body"
  fi
fi

if [ "$problems" -eq 0 ]; then
  echo "OK: message is valid (${subj_len}/${limit} char subject)."
  exit 0
else
  echo "Found ${problems} problem(s)." >&2
  exit 1
fi
