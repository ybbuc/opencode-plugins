import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setImmediate } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { buildSync } from "esbuild"

const { outputFiles } = buildSync({
  entryPoints: [fileURLToPath(new URL("./tui.tsx", import.meta.url))],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  // Capture JSX children without starting a terminal renderer.
  jsx: "transform",
  jsxFactory: "Array.of",
  logOverride: { "unsupported-jsx-comment": "silent" },
})
const { default: plugin } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`)

test("Claude Agent shows subscription usage but Anthropic API keys do not", { timeout: 5_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-claude-tui-"))
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = directory
  t.after(async () => {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(directory, { recursive: true })
  })
  await writeFile(join(directory, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "test-token" } }))
  const now = Date.now()
  t.mock.method(Date, "now", () => now)
  const fetched = Promise.withResolvers<void>()
  t.mock.method(globalThis, "fetch", async () => {
    fetched.resolve()
    return Response.json({
      five_hour: { utilization: 25, resets_at: new Date(now + 90 * 60_000).toISOString() },
      seven_day: { utilization: 40, resets_at: new Date(now + 5 * 3_600_000).toISOString() },
    })
  })
  let providerID = "claude-agent"
  let render: () => unknown[] | null = () => null
  const cleanup = plugin.setup({
    client: {
      experimental: { usage: { limits: async () => ({ data: {} }) } },
      credential: { list: async () => [{ integrationID: "claude-agent", value: { type: "external" } }] },
    },
    ui: {
      model: { current: () => ({ providerID }) },
      slot: (slot: { render: typeof render }) => { render = slot.render },
    },
  })
  t.after(cleanup)
  await fetched.promise
  await setImmediate()

  assert.equal(render()?.[2], "25% · 1h 30m | 40% · 5h")
  providerID = "anthropic"
  assert.equal(render(), null)
})

for (const { name, reset, expected } of [
  { name: "UTC reset", reset: { quota_reset_date_utc: new Date(2026, 1, 1).toISOString() }, expected: "66% → 126% · 15d 12h" },
  { name: "local date-only reset", reset: { quota_reset_date: "2026-02-01" }, expected: "66% → 126% · 15d 12h" },
  { name: "missing reset", reset: {}, expected: "66% · credits" },
  { name: "expired reset", reset: { quota_reset_date_utc: new Date(2026, 0, 1).toISOString() }, expected: "66% · <1m" },
]) {
  test(`Copilot terminal usage with ${name}`, async (t) => {
    t.mock.method(Date, "now", () => new Date(2026, 0, 16, 12).getTime())
    t.mock.method(globalThis, "fetch", async () => Response.json({
      quota_snapshots: { premium_interactions: { percent_remaining: 34, unlimited: false } },
      ...reset,
    }))
    let render: () => unknown[] | null = () => null
    const cleanup = plugin.setup({
      client: {
        experimental: { usage: { limits: async () => ({ data: {} }) } },
        credential: { list: async () => [{ integrationID: "github-copilot", value: { type: "oauth", access: "test-token" } }] },
      },
      ui: {
        model: { current: () => ({ providerID: "github-copilot" }) },
        slot: (slot: { render: typeof render }) => { render = slot.render },
      },
    })
    t.after(cleanup)
    await setImmediate()

    assert.equal(render()?.[2], expected)
  })
}

test("OpenCode Go usage reads the host's percent field", async (t) => {
  const now = new Date(2026, 0, 16, 12).getTime()
  t.mock.method(Date, "now", () => now)
  let render: () => unknown[] | null = () => null
  const cleanup = plugin.setup({
    client: {
      experimental: {
        usage: {
          limits: async () => ({
            data: { go: { rolling: { percent: 25, resetsAt: now + (2 * 60 + 14) * 60_000, limited: false } } },
          }),
        },
      },
      credential: { list: async () => [] },
    },
    ui: {
      model: { current: () => ({ providerID: "opencode-go" }) },
      slot: (slot: { render: typeof render }) => { render = slot.render },
    },
  })
  t.after(cleanup)
  await setImmediate()

  assert.equal(render()?.[2], "25% · 2h 14m")
})

for (const { name, reset, expected } of [
  {
    name: "known resets",
    reset: { session: new Date(2026, 0, 16, 13, 30).toISOString(), weekly: new Date(2026, 0, 16, 17).toISOString() },
    expected: "25% · 1h 30m | 40% · 5h",
  },
  { name: "missing resets", reset: {}, expected: "25% · session | 40% · weekly" },
]) {
  test(`Ollama terminal usage with ${name}`, async (t) => {
    const now = new Date(2026, 0, 16, 12).getTime()
    t.mock.method(Date, "now", () => now)
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({
        included: {
          session: { remaining_percent: 75, ...(reset.session ? { resets_at: reset.session } : {}) },
          weekly: { remaining_percent: 60, ...(reset.weekly ? { resets_at: reset.weekly } : {}) },
        },
        purchased: { balance_usd: 0 },
      }),
    )
    let render: () => unknown[] | null = () => null
    const cleanup = plugin.setup({
      client: {
        experimental: { usage: { limits: async () => ({ data: {} }) } },
        credential: { list: async () => [{ integrationID: "ollama-cloud", value: { type: "key", key: "test-key" } }] },
      },
      ui: {
        model: { current: () => ({ providerID: "ollama-cloud" }) },
        slot: (slot: { render: typeof render }) => { render = slot.render },
      },
    })
    t.after(cleanup)
    await setImmediate()

    assert.equal(render()?.[2], expected)
  })
}
