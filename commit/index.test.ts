// Self-check for the commit plugin: `npm test`.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { check, checkMessage, commitMessageFile, gitContext, reflow } from "./index.ts"

test("checkMessage: subjects over 72 chars fail, with or without noType", () => {
  assert.match(checkMessage("x".repeat(80) + "\n", { noType: true })[0] ?? "", /80 chars/)
  assert.deepEqual(checkMessage("feat: add x\n"), [])
})

test("checkMessage: ticket prefixes are allowed before the type, or alone with noType", () => {
  assert.deepEqual(checkMessage("MYSECURITY-1629: fix(status): make link real\n"), [])
  assert.deepEqual(checkMessage("MYSECURITY-1547/1548: Address review findings\n", { noType: true }), [])
})

test("reflow: bullets wrap with a two-space indent; trailers stay on their own lines", () => {
  const message = `feat: x\n\n- one two three four five six seven eight nine ten eleven twelve thirteen\n\nwhy.\n\nRefs: #1\nCloses: #2\n`
  const expected = `feat: x

- one two three four five six
  seven eight nine ten eleven
  twelve thirteen

why.

Refs: #1
Closes: #2
`
  assert.equal(reflow(message, 30), expected)
})

test("gitContext: works in a repo with no commits", async () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "commit-test-"))
  execFileSync("git", ["init", "-q", repo])
  writeFileSync(path.join(repo, "a"), "hi\n")
  const context = await gitContext({ cwd: repo })
  assert.match(context, /empty tree \(no commits yet\)/)
  assert.match(context, /--- a\nhi/)
})

test("setup: the permission hook shows the commit message, and only for commits", async () => {
  const { default: plugin } = await import("./index.ts")
  let evaluate: ((evaluation: { action: string; resources: string[]; message?: string }) => Promise<void>) | undefined
  const ctx = {
    location: { directory: process.cwd() },
    skill: { transform: async () => ({ dispose: async () => {} }) },
    tool: { transform: async () => ({ dispose: async () => {} }) },
    permission: {
      hook: async (name: string, callback: typeof evaluate) => {
        if (name === "evaluate") evaluate = callback
        return { dispose: async () => {} }
      },
    },
  }
  await plugin.setup(ctx as never)

  const file = (await check({ message: "feat: add x" })).file
  const commit: { action: string; resources: string[]; message?: string } = { action: "shell", resources: [`git commit -F ${file}`] }
  await evaluate!(commit)
  assert.equal(commit.message, "feat: add x")

  const staging: typeof commit = { action: "shell", resources: ["git add -A"] }
  await evaluate!(staging)
  assert.equal(staging.message, undefined)
})

test("commitMessageFile: finds the -F path of a git commit, not other commands", () => {
  assert.equal(commitMessageFile("git commit -F /tmp/a/MSG"), "/tmp/a/MSG")
  assert.equal(commitMessageFile('cd /r && git add -A && git commit -F "/tmp/b c/MSG" && git log -1'), "/tmp/b c/MSG")
  assert.equal(commitMessageFile('git commit -am "feat: add x"'), undefined)
  assert.equal(commitMessageFile("git commit"), undefined)
  assert.equal(commitMessageFile("git add -A"), undefined)
})

test("check: returns problems and a file holding the final message", async () => {
  const bad = await check({ message: "x".repeat(80), noType: true })
  assert.equal(bad.ok, false)
  assert.equal(readFileSync(bad.file, "utf8"), bad.message)

  const good = await check({ message: "feat: add x" })
  assert.deepEqual(good, { ...good, ok: true, problems: [], message: "feat: add x\n" })
})
