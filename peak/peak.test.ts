import assert from "node:assert/strict"
import { test } from "node:test"
import { formatRemainingTime, status } from "./peak.ts"

const flash = "deepseek-v4.1-flash:1017"

const statusAt = (iso: string, providerID: string, modelID = flash) => status(new Date(iso), providerID, modelID)

test("ollama peak window", () => {
  assert.deepEqual(statusAt("2026-10-29T13:00:00Z", "ollama-cloud"), {
    isPeak: true,
    nextTransitionAt: new Date("2026-10-29T18:00:00Z"),
  })
})

test("ollama just before and at the boundary", () => {
  assert.equal(statusAt("2026-10-29T11:59:59Z", "ollama-cloud")?.isPeak, false)
  assert.equal(statusAt("2026-10-29T11:59:59Z", "ollama-cloud")?.nextTransitionAt.toISOString(), "2026-10-29T12:00:00.000Z")
  assert.equal(statusAt("2026-10-29T18:00:00Z", "ollama-cloud")?.isPeak, false)
})

test("friday evening waits for monday", () => {
  assert.equal(statusAt("2026-10-30T18:00:00Z", "ollama-cloud")?.nextTransitionAt.toISOString(), "2026-11-02T12:00:00.000Z")
  assert.equal(statusAt("2026-10-31T13:00:00Z", "ollama-cloud")?.nextTransitionAt.toISOString(), "2026-11-02T12:00:00.000Z")
})

test("opencode go windows and the gap between them", () => {
  assert.equal(statusAt("2026-10-29T02:00:00Z", "opencode-go")?.isPeak, true)
  assert.equal(statusAt("2026-10-29T02:00:00Z", "opencode-go")?.nextTransitionAt.toISOString(), "2026-10-29T04:00:00.000Z")
  assert.equal(statusAt("2026-10-29T05:00:00Z", "opencode-go")?.isPeak, false)
  assert.equal(statusAt("2026-10-29T05:00:00Z", "opencode-go")?.nextTransitionAt.toISOString(), "2026-10-29T06:00:00.000Z")
  assert.equal(statusAt("2026-10-29T13:00:00Z", "opencode-go")?.nextTransitionAt.toISOString(), "2026-10-30T01:00:00.000Z")
})

test("weekends are off-peak", () => {
  assert.equal(statusAt("2026-11-01T02:00:00Z", "opencode-go")?.isPeak, false)
  assert.equal(statusAt("2026-11-01T02:00:00Z", "opencode-go")?.nextTransitionAt.toISOString(), "2026-11-02T01:00:00.000Z")
})

test("models and providers without peak pricing", () => {
  assert.equal(statusAt("2026-10-29T13:00:00Z", "opencode-go", "kimi-k3"), undefined)
  assert.equal(statusAt("2026-10-29T13:00:00Z", "anthropic"), undefined)
})

test("formatRemainingTime", () => {
  assert.equal(formatRemainingTime(0), "<1m")
  assert.equal(formatRemainingTime(59_000), "<1m")
  assert.equal(formatRemainingTime(38 * 60_000), "38m")
  assert.equal(formatRemainingTime((2 * 60 + 14) * 60_000), "2h 14m")
  assert.equal(formatRemainingTime(10 * 60 * 60_000), "10h")
  assert.equal(formatRemainingTime(24 * 60 * 60_000), "1d")
  assert.equal(formatRemainingTime(47 * 60 * 60_000), "1d 23h")
  assert.equal(formatRemainingTime(48 * 60 * 60_000), "2d")
  assert.equal(formatRemainingTime((4 * 24 + 6) * 60 * 60_000), "4d 6h")
})
