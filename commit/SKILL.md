---
name: commit
description: Create a conventional-commit-style git commit from the current uncommitted changes, selecting all or a subset and splitting into multiple commits when needed. Use when the user asks to commit changes, write/generate a commit message, or make a conventional commit.
---

# Commit

Write and create a professional, conventional-commit-style commit from the changes in the working tree. The working tree is the source of truth: modified, deleted, and untracked files all count as "changes to commit". The git index is not consulted; staging is an internal step performed immediately before committing. Use the diff plus this session's context and reasoning to produce the message.

## Workflow

1. **Collect context.** Call the `tools.commit.context` tool (`amend: true` only if the user asks to amend the last commit). Read the branch, recent commit subjects (to match house style), working-tree status, the diff summary and diff, and untracked files. Paths are relative to the repo root. If the working tree is clean, say so and stop, unless amending, where a message-only amend is valid. If it prints a **possible secret files** warning, ask the user before including those files.

2. **Resolve selection.** Default to **all** uncommitted changes.
   - If the user names files or asks to leave some out, select accordingly.
   - Otherwise, present the modified/untracked file list and proceed with all of it — no staging decision is required from the user. Only ask when the purpose is genuinely ambiguous.
   - If the user asks for a git-ignored file, stage it with `git add -f -- <path>` in step 9; nothing else is needed.

3. **Decide whether to split.** If the changes mix unrelated concerns (e.g. a feature plus an unrelated chore, or several features), propose splitting into separate commits rather than one mixed commit. Skip this if the user asks for one commit. If the user asks to split, propose it even when the changes are cohesive; otherwise prefer a single commit for cohesive changes and do not split trivially. Splits are by whole file; if one file mixes concerns, ask the user rather than splitting hunks. If split:
   - Draft every message (steps 4–7), then confirm the numbered plan once in step 8, so the user picks which commits to make in their next reply.
   - Then run steps 9–10 per selected commit, in the agreed order, staging only that commit's paths.

4. **Use two sources of truth.** Combine:
   - the **working-tree diff** — what is actually being committed, and
   - **this session's context** — what the user asked for, which files you changed, and why.

   Never invent intent the diff does not support. If the purpose is unclear, ask the user rather than guessing.

5. **Choose the type:** the type of the single dominant change, or `none` when recent subjects mostly have no type. Follow a type the user names (`type=none`, or "fix the parser" means `fix`). Add a scope when a clear module/area emerges, and a ticket prefix when recent subjects use one. See `references/message-format.md` for types, scope, and subject rules.

6. **Draft the message**, following `references/message-format.md`, which decides between brief and detailed. Honor a brief or detailed request from the user. Detailed is: subject line → blank line → `- ` bullets for distinct changes, if any → blank line → a one- or two-sentence paragraph explaining **why**.

7. **Reflow, then validate.** Pass the draft to the `tools.commit.check` tool (`noType: true` when the message has no type prefix). It reflows, validates, and returns `ok`, the `problems` found, the final `message`, and a `file` holding it for step 9. Fix every problem and call it again until `ok` is true.

8. **Confirm.** Show the exact validated message in your final reply, ask for approval in plain text, and end the turn. Wait for the user's response before any further tool calls.
   - **single commit**: list the included paths, print the returned `message` unchanged in a fenced `text` block, and finish with: "Commit with this message?"
   - **split plan**: number each commit, list its paths, and print its returned `message` unchanged in a fenced `text` block. Ask which commits to make. Commit only the selected ones, in the drafted order; clarify an ambiguous selection before staging.

   Wait for clear approval of the previewed message or selected commits before staging or committing.

   If the user requests changes, apply them and re-run step 7, then show the revised preview and end the turn again. Use the newly returned `file` only after the user approves that revised message.

9. **Stage, then commit.** Stage the selection explicitly from the repo root (`git add -A` for all, or `git add -- <paths>` for a subset), then commit the validated file as-is:

   ```bash
   git commit -F <file>
   ```

   Use `--amend` only if the user asks to amend the last commit. Never pass `--no-verify` unless asked. The only git commands that write are `git add` and `git commit`. Never run `push`, `reset`, `stash`, `checkout`, `restore`, or `tag`, even after approval: approval covers the commit, nothing else.

10. **Report.** Show `git log -1 --oneline` and the resulting working-tree state. If the commit fails (hook rejection, nothing to commit, lock file), show the error verbatim and stop — do not retry blindly.

## Guardrails

- The default selection is every uncommitted change; do not commit only part of it silently. When splitting or when the user limits the selection, stage exactly that subset and keep files out of a commit they don't belong to.
- Staging (`git add`) happens in step 9, immediately before the commit. Do not stage as a side effect of collecting context, and never stage or commit before the user approves the preview in step 8.
- Never add `Co-Authored-By`, sign-off, or tool/agent attribution unless the user explicitly asks.
- Never put secrets, tokens, or `.env` contents in the message; if the diff contains them, warn the user instead.
- If the user asks for a non-conventional message, set `type=none`, skip the type prefix, keep the subject/body structure, and validate with `noType: true`.

## Files

- `index.ts` — the plugin: `tools.commit.context` (`gitContext`) and `tools.commit.check` (`reflow` + `checkMessage`). Run `npm test` and `npm run typecheck` after editing it.
- `references/message-format.md` — types, scope, subject, brief vs detailed.
