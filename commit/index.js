// commit — OpenCode plugin, self-contained.
//
// Owns the commit skill (SKILL.md + scripts/) and exposes its deterministic
// steps as typed tools so the model calls them instead of hand-rolling bash:
//   commit_context  -> scripts/git-context.sh
//   commit_check    -> scripts/reflow-message.sh then scripts/check-message.sh
//
// The judgment (what to commit, how to split, the message itself) stays in the
// skill, which setup() registers from the SKILL.md beside this file.

import { execFile } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const run = promisify(execFile)
const root = path.dirname(fileURLToPath(import.meta.url))
const scriptsDir = path.join(root, "scripts")

// Split "---\nname: ...\ndescription: ...\n---\nbody" into fields + body.
function parseSkill(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  const front = match ? match[1] : ""
  const content = match ? match[2] : text
  const field = (key) => (new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front)?.[1] ?? "").trim()
  return { name: field("name"), description: field("description"), content }
}

export function makeTools({ cwd } = {}) {
  const sh = (script, args, signal) =>
    run("bash", [path.join(scriptsDir, script), ...args], { cwd, signal, maxBuffer: 10 * 1024 * 1024 })

  async function context({ amend = false } = {}, signal) {
    return (await sh("git-context.sh", amend ? ["--amend"] : [], signal)).stdout
  }

  async function check({ message, noType = false, wrap = 70, noReflow = false }, signal) {
    // ponytail: temp file left for `git commit -F`; $TMPDIR cleanup handles it.
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), "commit-msg-")), "MSG")
    await writeFile(file, message.endsWith("\n") ? message : message + "\n")
    if (!noReflow) await sh("reflow-message.sh", [file, String(wrap), "--in-place"], signal)

    let ok = true
    let out
    try {
      out = (await sh("check-message.sh", noType ? [file, "--no-type"] : [file], signal)).stdout
    } catch (e) {
      if (e.code !== 1) throw e // exit 2 is a usage error, not a message problem
      ok = false
      out = e.stdout
    }

    const problems = out
      .split("\n")
      .filter((line) => line.startsWith("FAIL: "))
      .map((line) => line.slice(6))
    return { ok, problems, message: await readFile(file, "utf8"), file }
  }

  return { context, check }
}

export default {
  id: "commit",

  async setup(ctx) {
    const tools = makeTools({ cwd: ctx.location.directory })

    // The skill ships with the plugin, so register it from the local file.
    const skillFile = path.join(root, "SKILL.md")
    const skill = parseSkill(await readFile(skillFile, "utf8"))
    await ctx.skill.transform((editor) => {
      editor.add({
        id: "commit",
        name: skill.name || "commit",
        description: skill.description,
        path: skillFile,
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
        execute: async (input, c) => ({ content: await tools.context(input, c.signal) }),
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
        execute: async (input, c) => ({ content: JSON.stringify(await tools.check(input, c.signal), null, 2) }),
      })
    })
  },
}
