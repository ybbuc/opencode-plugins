#!/usr/bin/env bash
# Reflow a commit message body to a fixed width.
#
# Rules:
#   - The first line (subject) is preserved exactly as-is.
#   - Blank lines are preserved as paragraph separators.
#   - Consecutive non-blank, non-list lines are unwrapped and re-wrapped as one
#     prose paragraph at the wrap length, with no indent.
#   - Bullet items ("- ") absorb their continuation lines and are re-wrapped at
#     the wrap length, with continuation lines indented by two spaces.
#   - Trailer lines ("Refs: #1", "BREAKING CHANGE: x") are kept verbatim.
#
# Usage: reflow-message.sh <file> [wrap-length] [--in-place]
#   wrap-length  target line width (default 70)
#   --in-place   rewrite <file> instead of printing to stdout
#
# Exit 0 on success; exit 2 on a missing/unreadable file.

set -eu

# Character-accurate length checks for non-ASCII text.
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

in_place=0
args=()
for arg in "$@"; do
  case "$arg" in
    --in-place) in_place=1 ;;
    *) args+=("$arg") ;;
  esac
done

file="${args[0]:-}"
wrap_length="${args[1]:-70}"

if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Usage: reflow-message.sh <file> [wrap-length] [--in-place]" >&2
  exit 2
fi

if ! printf '%s' "$wrap_length" | grep -Eq '^[0-9]+$' || [ "$wrap_length" -lt 1 ]; then
  echo "ERROR: wrap-length must be a positive integer." >&2
  exit 2
fi

trim() {
  printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# Trailers ("Refs: #1", "Closes #2", "BREAKING CHANGE: x") are never joined or wrapped.
# ponytail: any "Word: " line counts, so prose starting that way is left unwrapped.
trailer_re='^([A-Za-z][A-Za-z0-9-]*|BREAKING CHANGE)(: | #)'
is_trailer() { [[ "$1" =~ $trailer_re ]]; }

# Populates the global WRAPPED array with the wrapped lines of $1.
wrap_text() {
  local text="$1" indent="$2"
  local current="" word
  local -a words=()
  local -a out=()

  WRAPPED=()

  if [ "${#text}" -le "$wrap_length" ]; then
    WRAPPED=("$text")
    return
  fi

  IFS=' ' read -r -a words <<<"$text"

  for word in "${words[@]+"${words[@]}"}"; do
    if [ -z "$current" ]; then
      if [ "${#out[@]}" -eq 0 ]; then
        current="$word"
      else
        current="$indent$word"
      fi
    elif [ $(( ${#current} + 1 + ${#word} )) -le "$wrap_length" ]; then
      current="$current $word"
    else
      out+=("$current")
      current="$indent$word"
    fi
  done

  if [ -n "$current" ]; then
    out+=("$current")
  fi

  WRAPPED=("${out[@]+"${out[@]}"}")
}

# Read all lines (works with or without a trailing newline).
lines=()
while IFS= read -r line || [ -n "$line" ]; do
  lines+=("$line")
done <"$file"

count="${#lines[@]}"

if [ "$count" -eq 0 ]; then
  [ "$in_place" -eq 1 ] || printf '\n'
  exit 0
fi

output=("${lines[0]}")

i=1
while [ "$i" -lt "$count" ]; do
  line="${lines[$i]}"
  trimmed="$(trim "$line")"

  if [ -z "$trimmed" ] || is_trailer "$trimmed"; then
    output+=("$line")
    i=$((i + 1))
    continue
  fi

  case "$trimmed" in
    "- "*)
      item="$trimmed"
      i=$((i + 1))
      while [ "$i" -lt "$count" ]; do
        next="$(trim "${lines[$i]}")"
        [ -z "$next" ] && break
        is_trailer "$next" && break
        case "$next" in "- "*) break ;; esac
        item="$item $next"
        i=$((i + 1))
      done
      wrap_text "$item" "  "
      output+=("${WRAPPED[@]+"${WRAPPED[@]}"}")
      ;;
    *)
      paragraph="$trimmed"
      i=$((i + 1))
      while [ "$i" -lt "$count" ]; do
        next="$(trim "${lines[$i]}")"
        [ -z "$next" ] && break
        is_trailer "$next" && break
        case "$next" in "- "*) break ;; esac
        paragraph="$paragraph $next"
        i=$((i + 1))
      done
      wrap_text "$paragraph" ""
      output+=("${WRAPPED[@]+"${WRAPPED[@]}"}")
      ;;
  esac
done

render() {
  local n="${#output[@]}"
  local j=0
  while [ "$j" -lt "$n" ]; do
    printf '%s\n' "${output[$j]}"
    j=$((j + 1))
  done
}

if [ "$in_place" -eq 1 ]; then
  tmp="$(mktemp "${TMPDIR:-/tmp}/reflow.XXXXXX")"
  render >"$tmp"
  mv "$tmp" "$file"
else
  render
fi
