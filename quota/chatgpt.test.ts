import assert from "node:assert/strict"
import test from "node:test"
import { parse } from "./chatgpt.ts"

test("5-hour and weekly windows by slot", () => {
  const usage = parse({
    rate_limit: {
      primary_window: { used_percent: 12.6, reset_at: 1_700_000_000, limit_window_seconds: 18_000 },
      secondary_window: { used_percent: 40, reset_at: 1_700_500_000, limit_window_seconds: 604_800 },
    },
  })
  assert.deepEqual(usage.session, { usedPercent: 13, resetsAt: 1_700_000_000_000 })
  assert.deepEqual(usage.weekly, { usedPercent: 40, resetsAt: 1_700_500_000_000 })
})

test("slot names are ignored when the durations say otherwise", () => {
  const usage = parse({
    rate_limit: {
      primary_window: { used_percent: 39, reset_at: 1, limit_window_seconds: 604_800 },
      secondary_window: null,
    },
  })
  assert.equal(usage.session, undefined)
  assert.equal(usage.weekly?.usedPercent, 39)
})

test("windows without a duration or a percentage are skipped", () => {
  assert.deepEqual(parse({ rate_limit: { primary_window: { reset_at: 1 } } }), {})
  assert.deepEqual(parse({}), {})
})
