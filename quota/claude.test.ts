import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { loadUsage, parse } from "./claude.ts"

test("Claude usage reports percentages consumed and ISO reset times", () => {
  assert.deepEqual(parse({
    five_hour: { utilization: 12.6, resets_at: "2026-11-11T16:40:00Z" },
    seven_day: { utilization: 40, resets_at: "2026-11-12T22:00:00Z" },
  }), {
    session: { usedPercent: 13, resetsAt: 1_794_415_200_000 },
    weekly: { usedPercent: 40, resetsAt: 1_794_520_800_000 },
  })
})

test("Claude omits unavailable or invalid windows without inventing reset times", () => {
  for (const body of [null, {}, { five_hour: null }, { five_hour: { utilization: "25" } }, { seven_day: { utilization: Infinity } }, { seven_day: { utilization: -1 } }]) {
    assert.deepEqual(parse(body), {})
  }
  assert.deepEqual(parse({ five_hour: { utilization: 0, resets_at: null } }), { session: { usedPercent: 0, resetsAt: NaN } })
})

test("Claude reuses its file-backed login without modifying credentials and backs off on throttling", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-claude-"))
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = directory
  t.after(async () => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(directory, { recursive: true })
  })
  const path = join(directory, ".credentials.json")
  const credentials = JSON.stringify({ claudeAiOauth: { accessToken: "test-token", refreshToken: "leave-alone" } })
  await writeFile(path, credentials)
  let now = Date.now()
  t.mock.method(Date, "now", () => now)
  const request = t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, "https://api.anthropic.com/api/oauth/usage")
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token")
    assert.equal(new Headers(init?.headers).get("anthropic-beta"), "oauth-2025-04-20")
    assert.ok(init?.signal)
    return Response.json({ five_hour: { utilization: 25 } })
  })

  assert.equal((await loadUsage()).session?.usedPercent, 25)
  assert.equal(await readFile(path, "utf8"), credentials)

  request.mock.mockImplementation(async () => new Response(null, { status: 429 }))
  await assert.rejects(loadUsage(), /429/)
  await assert.rejects(loadUsage(), /rate-limited/)
  assert.equal(request.mock.callCount(), 2)

  now += 30 * 60_000
  request.mock.mockImplementation(async () => new Response(null, { status: 401 }))
  await assert.rejects(loadUsage(), /401/)
  assert.equal(await readFile(path, "utf8"), credentials)
})
