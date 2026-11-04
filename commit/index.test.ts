// Self-check for the commit plugin: `npm test`.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { check, checkMessage, gitContext, reflow } from "./index.ts"

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

test("check: returns problems and a file holding the final message", async () => {
  const bad = await check({ message: "x".repeat(80), noType: true })
  assert.equal(bad.ok, false)
  assert.equal(readFileSync(bad.file, "utf8"), bad.message)

  const good = await check({ message: "feat: add x" })
  assert.deepEqual(good, { ...good, ok: true, problems: [], message: "feat: add x\n" })
})
