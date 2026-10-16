---
name: commit
description: Create a conventional-commit-style git commit from the current uncommitted changes, selecting all or a subset and splitting into multiple commits when needed. Use when the user asks to commit changes, write/generate a commit message, or make a conventional commit.
---

# Commit

Write and create a professional, conventional-commit-style commit from the
changes in the working tree. The working tree is the source of truth: modified,
deleted, and untracked files all count as "changes to commit". The git index is
not consulted; staging is an internal step performed immediately before
committing. Use the diff plus this session's context and reasoning to produce
the message.

## Arguments

Interpret hints in the invocation text. Also honor plain-language requests
(e.g. "fix the parser" implies `type=fix`). Defaults are bold.

| Hint | Values | Default |
| --- | --- | --- |
| type | `auto`, `none`, or a type from `references/message-format.md` | **auto** |
| detail | `brief`, `detailed` | **detailed** |
| scope | free text, e.g. `--scope parser` | **none** |
| extra context | `--context "text"`, or the user's own explanation | **none** |
| reflow | word-wrap the body at N chars; `--wrap N` sets N, `--no-reflow` disables | **on (N = 70)** |
| selection | `--paths "a b"` (commit only those); otherwise **all** uncommitted changes | **all** |
| split | `--split` (propose multiple commits), `--no-split` | auto-propose |
| `--amend` | amend the previous commit instead of creating a new one | off |
| `--no-confirm` | commit without asking for approval first | off |

## Workflow

1. **Collect context.** Call the `commit_context` tool (`amend: true` when
   amending).
   Read the branch, recent commit subjects (to match house style),
   working-tree status, the diff summary and diff, and untracked files. Paths
   are relative to the repo root. The tool is read-only and never stages anything, and it
   works before the first commit. If the working tree is clean, say so and
   stop, unless amending, where a message-only amend is valid. If it prints a
   **possible secret files** warning, ask the user before including those
   files.

2. **Resolve selection.** Default to **all** uncommitted changes.
   - With `--paths "a b"`, select only those paths.
   - Otherwise, present the modified/untracked file list and proceed with all of
     it — no staging decision is required from the user. Only ask when the
     purpose is genuinely ambiguous.
   - If the user asks for a git-ignored file, stage it with
     `git add -f -- <path>` in step 9; nothing else is needed.

3. **Decide whether to split.** If the changes mix unrelated concerns (e.g. a
   feature plus an unrelated chore, or several features), propose splitting into
   separate commits rather than one mixed commit. Skip this when `--no-split` is
   given. Prefer a single commit when the changes are cohesive; do not split
   trivially. Splits are by whole file; if one file mixes concerns, ask the user
   rather than splitting hunks. If split:
   - Draft every message (steps 4–7), then present the plan once: each commit's
     paths and its full message. One approval covers all of them.
   - Then run steps 9–10 per commit, in the agreed order, staging only that
     commit's paths.

4. **Use two sources of truth.** Combine:
   - the **working-tree diff** — what is actually being committed, and
   - **this session's context** — what the user asked for, which files you
     changed, and why.

   Never invent intent the diff does not support. If the purpose is unclear,
   ask the user rather than guessing.

5. **Choose the type** when `type=auto`: the type of the single dominant change,
   or `none` when recent subjects mostly have no type. Add a scope when a clear
   module/area emerges, and a ticket prefix when recent subjects use one. See
   `references/message-format.md` for types, scope, and subject rules.

6. **Draft the message** at the requested detail level, following
   `references/message-format.md`:
   - **detailed** (default): subject line → blank line → `- ` bullets of what
     changed → blank line → one paragraph explaining **why**.
   - **brief**: subject line only.

7. **Reflow, then validate.** Pass the draft to the `commit_check` tool
   (`wrap: N`, `noReflow: true` for `--no-reflow`, `noType: true` when
   `type=none`). It reflows, validates, and returns `ok`, the `problems` found,
   the final `message`, and a `file` holding it for step 9. Fix every problem
   and call it again until `ok` is true.

8. **Confirm.** Unless `--no-confirm` was passed or the user already approved,
   show the exact message in a fenced block and ask for approval. Apply edits
   and re-run step 7, then use the newly returned `file`.

9. **Stage, then commit.** Stage the selection explicitly from the repo root
   (`git add -A` for all, or `git add -- <paths>` for a subset), then commit the
   validated file as-is:

   ```bash
   git commit -F <file>
   ```

   Add `--amend` only if requested. Never pass `--no-verify` unless asked.
   The only git commands that write are `git add` and `git commit`. Never
   run `push`, `reset`, `stash`, `checkout`, `restore`, or `tag`, even after
   approval: approval covers the commit, nothing else.

10. **Report.** Show `git log -1 --oneline` and the resulting working-tree state.
    If the commit fails (hook rejection, nothing to commit, lock file), show the
    error verbatim and stop — do not retry blindly.

## Guardrails

- The default selection is every uncommitted change; do not commit only part of
  it silently. When splitting or given `--paths`, stage exactly that subset and
  keep files out of a commit they don't belong to.
- Staging (`git add`) happens in step 9, immediately before the commit. Do not
  stage as a side effect of collecting context.
- Never add `Co-Authored-By`, sign-off, or tool/agent attribution unless the
  user explicitly asks.
- Never put secrets, tokens, or `.env` contents in the message; if the diff
  contains them, warn the user instead.
- If the user asks for a non-conventional message, set `type=none`, skip the
  type prefix, keep the subject/body structure, and validate with `noType: true`.

## Files

- `index.ts` — the plugin: `commit_context` (`gitContext`) and `commit_check`
  (`reflow` + `checkMessage`). Run `npm test` and `npm run typecheck` after
  editing it.
- `references/message-format.md` — types, scope, subject, brief vs detailed.
