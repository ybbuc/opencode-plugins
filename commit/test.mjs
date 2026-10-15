// Self-check for the commit plugin: run with `node --test`.
import { test } from "node:test"
import assert from "node:assert/strict"
import { makeTools } from "./index.js"

const { check } = makeTools()

test("valid message passes", async () => {
  assert.equal((await check({ message: "feat: add x" })).ok, true)
})

test("80-char subject fails with a reason", async () => {
  const r = await check({ message: "x".repeat(80), noType: true })
  assert.equal(r.ok, false)
  assert.match(r.problems[0], /80 chars/)
})
