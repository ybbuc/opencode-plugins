// commit — OpenCode plugin, self-contained.
//
// Owns the commit skill (SKILL.md) and exposes its deterministic steps as typed
// tools:
//   commit_context  -> gitContext(): read-only working-tree context
//   commit_check    -> reflow() then checkMessage(), plus a file for `git commit -F`
//
// The judgment (what to commit, how to split, the message itself) stays in the
// skill, which setup() registers from the SKILL.md beside this file.

import { execFile } from "node:child_process"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type { Plugin, Skill } from "@opencode/plugin"

const run = promisify(execFile)

const SUBJECT_LIMIT = 72
const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"]
const MAX_DIFF_CHARS = 120_000
const UNTRACKED_PREVIEW_BYTES = 4000
const MAX_PREVIEWS = 20

// Trailers ("Refs: #1", "Closes #2", "BREAKING CHANGE: x") are never joined or wrapped.
// ponytail: any "Word: " line counts, so prose starting that way is left unwrapped.
const TRAILER = /^([A-Za-z][A-Za-z0-9-]*|BREAKING CHANGE)(: | #)/
const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?)$/i

// Length in characters, not UTF-16 units, so non-ASCII text measures correctly.
const len = (s: string) => [...s].length

/** Validate a commit message. Returns the problems found; empty means valid. */
export function checkMessage(text: string, { noType = false } = {}): string[] {
  const problems: string[] = []
  const lines = text.split("\n")
  const subject = lines[0] ?? ""

  // An optional ticket prefix ("ABC-123: ", "ABC-1/2/3: ") precedes everything else.
  const ticket = /^[A-Z][A-Z0-9]*-[0-9]+(\/[0-9]+)*: /.exec(subject)
  const summary = ticket ? subject.slice(ticket[0].length) : subject
  if (ticket && !summary) problems.push("nothing follows the ticket prefix")

  const types = TYPES.join("|")
  if (!noType && !new RegExp(`^(${types})(\\([^)]+\\))?!?: .+`).test(summary)) {
    problems.push(`subject must match '[TICKET-1: ]type(scope): summary' (types: ${TYPES.join(", ")})`)
  }

  const subjectLength = len(subject)
  if (subjectLength === 0) problems.push("subject line is empty")
  else if (subjectLength > SUBJECT_LIMIT) problems.push(`subject is ${subjectLength} chars; limit is ${SUBJECT_LIMIT}`)

  if (subject.endsWith(".")) problems.push("subject must not end with a period")

  if (!noType && new RegExp(`^(${types})(\\([^)]+\\))?!?: [A-Z]`).test(summary)) {
    problems.push("summary should start lowercase after the colon")
  }

  if (lines.some((line) => line.startsWith("```"))) problems.push("message must not contain markdown code fences")
  if (lines.some((line) => /^\s*\*\s+/.test(line))) problems.push("use '-' for bullet points, not '*'")
  if (lines.some((line) => /^(summary|rationale|changes|description|why|context):/i.test(line))) {
    problems.push("remove section labels like 'Summary:' or 'Rationale:'")
  }

  const hasBody = lines.slice(1).some((line) => line.trim() !== "")
  if (hasBody && lines[1] !== "") problems.push("put a blank line between the subject and the body")

  return problems
}

function wrapLine(text: string, width: number, indent: string): string[] {
  if (len(text) <= width) return [text]
  const out: string[] = []
  let current = ""
  for (const word of text.split(" ").filter(Boolean)) {
    if (!current) current = out.length === 0 ? word : indent + word
    else if (len(current) + 1 + len(word) <= width) current += " " + word
    else {
      out.push(current)
      current = indent + word
    }
  }
  if (current) out.push(current)
  return out
}

/**
 * Reflow a commit message body to a fixed width. The subject, blank lines, and
 * trailers are kept as-is; prose paragraphs are re-wrapped with no indent, and
 * "- " bullets absorb their continuation lines, wrapping with a two-space indent.
 */
export function reflow(text: string, width = 70): string {
  const lines = text.replace(/\n$/, "").split("\n")
  const out = [lines[0] ?? ""]
  let i = 1
  while (i < lines.length) {
    const line = lines[i] ?? ""
    const trimmed = line.trim()
    if (!trimmed || TRAILER.test(trimmed)) {
      out.push(line)
      i++
      continue
    }

    let joined = trimmed
    i++
    while (i < lines.length) {
      const next = (lines[i] ?? "").trim()
      if (!next || TRAILER.test(next) || next.startsWith("- ")) break
      joined += " " + next
      i++
    }
    out.push(...wrapLine(joined, width, trimmed.startsWith("- ") ? "  " : ""))
  }
  return out.join("\n") + "\n"
}

/**
 * Read-only working-tree context for writing a commit message. Everything
 * uncommitted counts; the index is ignored. Paths are relative to the repo root.
 */
export async function gitContext({
  amend = false,
  cwd,
  signal,
}: { amend?: boolean; cwd?: string; signal?: AbortSignal } = {}): Promise<string> {
  const gitIn = async (dir: string | undefined, ...args: string[]) =>
    (await run("git", ["--no-pager", ...args], { cwd: dir, signal, maxBuffer: 64 * 1024 * 1024 })).stdout
  const attempt = (promise: Promise<string>) => promise.catch(() => undefined)

  if (!(await attempt(gitIn(cwd, "rev-parse", "--is-inside-work-tree")))) {
    throw new Error("not inside a git working tree")
  }
  const root = (await gitIn(cwd, "rev-parse", "--show-toplevel")).trim()
  const git = (...args: string[]) => gitIn(root, ...args)

  const branch = (await attempt(git("symbolic-ref", "--short", "-q", "HEAD")))?.trim() || "(detached HEAD)"
  const emptyTree = (await git("hash-object", "-t", "tree", "/dev/null")).trim()
  const hasHead = (await attempt(git("rev-parse", "-q", "--verify", "HEAD"))) !== undefined

  let base = "HEAD"
  let baseLabel = "HEAD"
  if (!hasHead) {
    base = emptyTree
    baseLabel = "empty tree (no commits yet)"
  } else if (amend) {
    base = (await attempt(git("rev-parse", "-q", "--verify", "HEAD~1")))?.trim() || emptyTree
    baseLabel = "HEAD~1 (amending HEAD)"
  }

  const sections: string[] = [`== Repo root ==\n${root}`, `== Branch ==\n${branch}`]
  const log = await attempt(git("log", "-10", "--pretty=format:%h %s"))
  sections.push(`== Recent commit subjects (style reference) ==\n${log?.trim() || "(no commits yet)"}`)
  if (amend && hasHead) {
    sections.push(`== Commit being amended ==\n${(await git("log", "-1", "--pretty=format:%h %s%n%n%b")).trimEnd()}`)
  }
  sections.push(`== Working tree status ==\n${(await git("status", "--short")).trimEnd()}`)

  const untracked = (await git("ls-files", "--others", "--exclude-standard")).split("\n").filter(Boolean)
  const changedNames = (await git("diff", base, "--name-only")).split("\n").filter(Boolean)
  const secrets = [...changedNames, ...untracked].filter((name) => SECRET_FILE.test(name))
  if (secrets.length > 0) {
    sections.push(`== WARNING: possible secret files — confirm before committing ==\n${secrets.join("\n")}`)
  }

  sections.push(`== Changes vs ${baseLabel} (summary) ==\n${(await git("diff", base, "--stat")).trimEnd()}`)

  let diff = (await git("diff", base)).trimEnd()
  if (diff.length > MAX_DIFF_CHARS) {
    diff =
      `NOTE: diff is ${diff.length} chars; truncated to ${MAX_DIFF_CHARS} chars. See the summary above for every file.\n` +
      `${diff.slice(0, MAX_DIFF_CHARS)}\n... [diff truncated] ...`
  }
  sections.push(`== Changes vs ${baseLabel} (tracked) ==\n${diff}`)

  const previews: string[] = []
  for (const [index, name] of untracked.entries()) {
    previews.push(`--- ${name}`)
    if (index >= MAX_PREVIEWS) continue
    const file = path.join(root, name)
    const isFile = await stat(file).then((s) => s.isFile(), () => false)
    if (!isFile) continue
    const head = (await readFile(file)).subarray(0, UNTRACKED_PREVIEW_BYTES)
    // Skip binary (NUL byte) and empty files; only preview text.
    if (head.length > 0 && !head.includes(0)) previews.push(head.toString("utf8"))
  }
  if (untracked.length === 0) previews.push("(none)")
  else if (untracked.length > MAX_PREVIEWS) {
    previews.push(`NOTE: ${untracked.length} untracked files; only the first ${MAX_PREVIEWS} are previewed.`)
  }
  sections.push(`== Untracked files ==\n${previews.join("\n")}`)

  return sections.join("\n\n") + "\n"
}

/**
 * Reflow and validate a draft message, then write it to a fresh temp file for
 * `git commit -F`. Each call gets its own file, so split commits never collide.
 */
export async function check({
  message,
  noType = false,
  wrap = 70,
  noReflow = false,
}: {
  message: string
  noType?: boolean
  wrap?: number
  noReflow?: boolean
}) {
  const final = noReflow ? (message.endsWith("\n") ? message : message + "\n") : reflow(message, wrap)
  const problems = checkMessage(final, { noType })
  // ponytail: temp file left for `git commit -F`; $TMPDIR cleanup handles it.
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), "commit-msg-")), "MSG")
  await writeFile(file, final)
  return { ok: problems.length === 0, problems, message: final, file }
}

// Split "---\nname: ...\ndescription: ...\n---\nbody" into fields + body.
function parseSkill(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const front = match?.[1] ?? ""
  const content = match?.[2] ?? text
  const field = (key: string) => (new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front)?.[1] ?? "").trim()
  return { name: field("name"), description: field("description"), content }
}

const plugin = {
  id: "commit",

  async setup(ctx) {
    const cwd = ctx.location.directory

    // The skill ships with the plugin, so register it from the local file.
    const skillFile = path.join(import.meta.dirname, "SKILL.md")
    const skill = parseSkill(await readFile(skillFile, "utf8"))
    await ctx.skill.transform((editor) => {
      editor.add({
        id: "commit" as Skill.ID,
        name: (skill.name || "commit") as Skill.Name,
        description: skill.description,
        path: skillFile as Skill.Info["path"],
        content: skill.content,
      })
    })

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "commit",
        description: "Deterministic helpers for the commit skill",
      })

      editor.add({
        name: "context",
        description:
          "Read-only git context for writing a commit: branch, recent subjects, status, diff, untracked files, secret-file warnings.",
        input: {
          type: "object",
          properties: { amend: { type: "boolean" } },
          additionalProperties: false,
        },
        options: { namespace: "commit" },
        execute: async (input, context) => ({
          content: await gitContext({ ...(input as { amend?: boolean }), cwd, signal: context.signal }),
        }),
      })

      editor.add({
        name: "check",
        description:
          "Reflow and validate a commit message. Returns { ok, problems, message, file }; commit with `git commit -F <file>` once ok.",
        input: {
          type: "object",
          properties: {
            message: { type: "string" },
            noType: { type: "boolean" },
            wrap: { type: "integer", minimum: 1 },
            noReflow: { type: "boolean" },
          },
          required: ["message"],
          additionalProperties: false,
        },
        options: { namespace: "commit" },
        execute: async (input) => ({
          content: JSON.stringify(await check(input as Parameters<typeof check>[0]), null, 2),
        }),
      })
    })
  },
} satisfies Plugin.Plugin

export default plugin
