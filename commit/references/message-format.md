# Message format

## Types

| Type | Use for |
| --- | --- |
| `feat` | A new feature, capability, or enhancement |
| `fix` | A bug, error, or issue being resolved |
| `docs` | Documentation only |
| `style` | Formatting, whitespace, code style; no behavior change |
| `refactor` | Restructuring that does not change behavior |
| `perf` | A faster or cheaper operation; say which and the likely effect |
| `test` | Adding or updating tests |
| `build` | Build system or dependency changes |
| `ci` | CI configuration and scripts |
| `chore` | Other maintenance |
| `revert` | Reverting a commit; reference its hash and subject |

- `auto`: pick the type of the single dominant change. If recent subjects (ignoring any ticket prefix) mostly lack a type, use `none` instead.
- `none`: no type prefix; the subject starts with a plain summary, capitalized the way recent subjects are. All other rules still apply.

## Scope

Optional. Add `(scope)` when one module, component, or area stands out from the paths or session context: a short, lowercase noun. Omit it when the change is broad.

## Subject

`[TICKET-123: ]type(scope): summary`

- Ticket prefix: when recent subjects start with a ticket key (`ABC-123: `), start with one too. Take the ticket from the branch name; if the branch has none or the change spans other tickets, ask. Join several with `/` (`ABC-1/2: `). Writing it yourself also stops a `prepare-commit-msg` hook from adding a second one.
- Imperative mood: "add", "fix", "remove", not "added" or "adds".
- Lowercase first word after the type's colon; no trailing period.
- Aim for about 50 characters; 72 is the hard limit, prefix included.
- Mark a breaking change with `!` after the type/scope (`feat(api)!: ...`) and explain it in the body.

## Brief

The subject line only. Use it when the subject alone says what changed and why, with no breaking change to explain, or when the user asks for brief.

## Detailed

Use it otherwise, or when the user asks for detailed. Three parts separated by blank lines:

1. **Subject line.**
2. **Bullets** (`-`, never `*`): only for distinct changes, naming the files or areas touched. Leave out any bullet that only restates the subject.
3. **Why paragraph**: one non-bulleted paragraph of one or two sentences explaining the reason and its effect on the rest of the codebase, so that someone who knows the codebase but not this change understands why it was made.

Communicate intent rather than restating the diff, and do not guess intent the diff and session do not support. Professional tone. No section labels ("Summary:", "Rationale:"), no markdown fences.

Trailers (`Refs: #12`, `BREAKING CHANGE: ...`) go last, one per line, after a blank line. Reflow leaves them untouched.

## Example

```
feat(parser): support nested arithmetic expressions

- Add a recursive descent parser in Parser/Expression.swift
- Extend Token.swift with parenthesis tokens
- Cover nested cases in ParserTests

The previous flat parser rejected grouped expressions, which blocked
operator precedence. Recursive descent keeps the grammar explicit and
lets later work add precedence levels without restructuring the lexer.
```
