import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import plugin from "./index.ts"
import { logTurn, parseRow, redact, selectTurn } from "./log.ts"

const day = new Date(2026, 10, 20, 12)
const ACTIVE = "# Copilot usage log\n\nStatus: active\n\n## Entries\n"
const row = {
  log: true,
  project: "dotfiles",
  task: "infra/config",
  did: "Updated the zsh alias file",
  outcome: "Alias works after reload",
  review: "no",
}
const answer = (fields: object) => JSON.stringify(fields)
const user = (id: string, text: string) => ({ id, type: "user", text })
const step = (id: string, content: object[], extra: object = {}) => ({
  id,
  type: "assistant",
  model: { id: "claude-sonnet-4.5", providerID: "github-copilot" },
  finish: "tool-calls",
  content,
  tokens: { input: 100, output: 20 },
  ...extra,
})
const idle = (id: string, outcome = "succeeded") => ({ id, type: "idle", outcome })
const toolCall = (name: string, status = "completed", extra: object = {}) => ({
  type: "tool",
  name,
  state: {
    status,
    input: { command: "cat ~/.zshrc" },
    content: [{ type: "text", text: "alias ll='ls -la'" }],
    ...extra,
  },
})

const turn = () => [
  user("m1", "Fix the alias in my zsh config"),
  step("a1", [
    { type: "reasoning", text: "private chain" },
    { type: "text", text: "Looking at it" },
    toolCall("bash", "completed", {
      content: [{ type: "text", text: "alias ll='ls -la' token=ghp_abcdefghijklmnopqrstuvwxyz0123" }],
    }),
  ]),
  step("a2", [{ type: "text", text: "Fixed it" }], { finish: "stop" }),
  idle("i1"),
]

function fakeCtx(messages: unknown, { parentID, children = [], text = answer(row), error, onGenerate }: {
  parentID?: string
  children?: unknown[]
  text?: string
  error?: Error
  onGenerate?: () => void
} = {}) {
  const generate: Array<{ input: { prompt: string; model: unknown }; options: { signal?: AbortSignal } }> = []
  const ctx = {
    session: {
      get: async () => ({ id: "ses_1", parentID, location: { directory: "/repo" } }),
      context: async () => messages,
      list: async () => ({ data: children }),
    },
    experimental: {
      generate: {
        text: async (input: { prompt: string; model: unknown }, options: { signal?: AbortSignal }) => {
          generate.push({ input, options })
          onGenerate?.()
          if (error) throw error
          return { text }
        },
      },
    },
  }
  return { ctx, generate }
}

function logFile(content?: string) {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "copilot-usage-")), "copilot-usage-log.md")
  if (content !== undefined) writeFileSync(file, content)
  return file
}

const rowLines = (file: string) => readFileSync(file, "utf8").split("\n").filter((line) => line.startsWith("- "))

test("a completed Copilot-only turn appends one row built from metadata", async () => {
  const file = logFile("# Copilot usage log\n\nStatus: active\n\n## Entries")
  const { ctx, generate } = fakeCtx(turn())
  assert.equal(await logTurn(ctx, "ses_1", new Set(), file, day), true)
  assert.equal(
    readFileSync(file, "utf8").trimEnd().split("\n").at(-1),
    "- 2026-11-20 | dotfiles | infra/config | Updated the zsh alias file | " +
      "github-copilot/claude-sonnet-4.5 | Alias works after reload | review: no",
  )
  assert.deepEqual(generate[0].input.model, { id: "claude-haiku-5.5", providerID: "github-copilot" })
  assert.ok(generate[0].options.signal)
  const prompt = generate[0].input.prompt
  assert.match(prompt, /Fix the alias/)
  assert.match(prompt, /alias ll/)
  assert.match(prompt, /\[REDACTED\]/)
  assert.doesNotMatch(prompt, /private chain/)
  assert.doesNotMatch(prompt, /ghp_abcdef/)
})

test("non-Copilot and mixed-provider turns are skipped without a model call", async () => {
  const openai = turn().map((message) =>
    message.type === "assistant" ? { ...message, model: { id: "gpt-5", providerID: "openai" } } : message,
  )
  const mixed = [
    user("m1", "Fix it"),
    step("a1", [{ type: "text", text: "x" }]),
    step("a2", [{ type: "text", text: "y" }], { finish: "stop", model: { id: "gpt-5", providerID: "openai" } }),
    idle("i1"),
  ]
  for (const messages of [openai, mixed]) {
    const file = logFile(ACTIVE)
    const { ctx, generate } = fakeCtx(messages)
    assert.equal(await logTurn(ctx, "ses_1", new Set(), file, day), false)
    assert.equal(generate.length, 0)
    assert.equal(readFileSync(file, "utf8"), ACTIVE)
  }
})

test("a missing or inactive log makes no model call and creates no file", async () => {
  const missing = logFile()
  const closed = logFile("# Copilot usage log\n\nStatus: closed\n\n## Entries\n")
  const { ctx, generate } = fakeCtx(turn())
  assert.equal(await logTurn(ctx, "ses_1", new Set(), missing, day), false)
  assert.equal(existsSync(missing), false)
  assert.equal(await logTurn(ctx, "ses_1", new Set(), closed, day), false)
  assert.equal(generate.length, 0)
})

test("a duplicate completion event for the same turn appends once", async () => {
  const file = logFile(ACTIVE)
  const { ctx, generate } = fakeCtx({ data: turn() })
  const logged = new Set<string>()
  const results = await Promise.all([
    logTurn(ctx, "ses_1", logged, file, day),
    logTurn(ctx, "ses_1", logged, file, day),
  ])
  assert.equal(results.filter(Boolean).length, 1)
  assert.equal(generate.length, 1)
  assert.equal(rowLines(file).length, 1)
})

test("child sessions and turns with child sessions are skipped", async () => {
  const file = logFile(ACTIVE)
  const parent = fakeCtx(turn(), { parentID: "ses_0" })
  const withChild = fakeCtx(turn(), { children: [{ id: "ses_2" }] })
  const mismatched = {
    ...fakeCtx(turn()).ctx,
    session: {
      get: async () => ({ data: { id: "ses_9" } }),
      context: async () => turn(),
      list: async () => ({ data: [] }),
    },
  }
  assert.equal(await logTurn(parent.ctx, "ses_1", new Set(), file, day), false)
  assert.equal(await logTurn(withChild.ctx, "ses_1", new Set(), file, day), false)
  assert.equal(await logTurn(mismatched, "ses_1", new Set(), file, day), false)
  assert.equal(parent.generate.length + withChild.generate.length, 0)
  assert.equal(readFileSync(file, "utf8"), ACTIVE)
})

test("incomplete, interrupted, or subagent turns are not selected", () => {
  const cases = [
    turn().map((message) => (message.type === "idle" ? { ...message, outcome: "interrupted" } : message)),
    turn().map((message) => (message.id === "a2" ? { ...message, finish: "length" } : message)),
    turn().slice(0, -1),
    [user("m1", "Fix it"), step("a1", [toolCall("bash", "running")], { finish: "stop" }), idle("i1")],
    [user("m1", "Delegate"), step("a1", [toolCall("task")], { finish: "stop" }), idle("i1")],
  ]
  for (const messages of cases) assert.equal(selectTurn(messages as never), undefined)
})

test("unusable model answers append nothing", async () => {
  const bad = [
    answer({ ...row, log: false }),
    "SKIP",
    answer({ ...row, did: "Fixed a | b" }),
    answer({ ...row, outcome: "Took 2 hours" }),
    answer({ ...row, task: "vibes" }),
    answer({ ...row, did: "line one\nline two" }),
    answer({ ...row, project: "/Users/me/repo" }),
    answer({ ...row, review: "maybe" }),
  ]
  for (const text of bad) {
    const file = logFile(ACTIVE)
    const { ctx } = fakeCtx(turn(), { text })
    assert.equal(await logTurn(ctx, "ses_1", new Set(), file, day), false)
    assert.equal(readFileSync(file, "utf8"), ACTIVE)
  }
  assert.equal(parseRow(answer(row))?.task, "infra/config")
})

test("a failed model call is attempted once and appends nothing", async () => {
  const file = logFile(ACTIVE)
  const { ctx, generate } = fakeCtx(turn(), { error: new Error("timeout") })
  await assert.rejects(logTurn(ctx, "ses_1", new Set(), file, day), /timeout/)
  assert.equal(generate.length, 1)
  assert.equal(readFileSync(file, "utf8"), ACTIVE)
})

test("a log removed during generation is not recreated", async () => {
  const file = logFile(ACTIVE)
  const { ctx, generate } = fakeCtx(turn(), { onGenerate: () => unlinkSync(file) })
  assert.equal(await logTurn(ctx, "ses_1", new Set(), file, day), false)
  assert.equal(generate.length, 1)
  assert.equal(existsSync(file), false)
})

test("an oversized turn is skipped rather than sending a partial transcript", async () => {
  const file = logFile(ACTIVE)
  const messages = turn().map((message) => (message.id === "m1" ? { ...message, text: "x".repeat(100_001) } : message))
  const { ctx, generate } = fakeCtx(messages)
  assert.equal(await logTurn(ctx, "ses_1", new Set(), file, day), false)
  assert.equal(generate.length, 0)
})

test("the first Status line decides, and a wrapped generate result is accepted", async () => {
  const closed = logFile("Status: closed\n\n## Entries\nStatus: active\n")
  const { ctx, generate } = fakeCtx(turn())
  assert.equal(await logTurn(ctx, "ses_1", new Set(), closed, day), false)
  assert.equal(generate.length, 0)
  const file = logFile(ACTIVE)
  const wrapped = { ...fakeCtx(turn()).ctx, experimental: { generate: { text: async () => ({ data: { text: answer(row) } }) } } }
  assert.equal(await logTurn(wrapped, "ses_1", new Set(), file, day), true)
  assert.equal(rowLines(file).length, 1)
})

test("redact masks common credential shapes", () => {
  assert.equal(redact("token=abc123"), "token=[REDACTED]")
  assert.equal(redact("ghp_abcdefghijklmnopqrstuvwxyz0123"), "[REDACTED]")
  assert.equal(redact("Bearer abc.def-ghi"), "[REDACTED]")
  assert.equal(redact("ls -la"), "ls -la")
})

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 500 && !check(); attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
}

test("setup checks the session location after a successful execution", { timeout: 5000 }, async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "copilot-usage-home-"))
  const file = path.join(home, ".local", "share", "copilot-usage-log.md")
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, ACTIVE)
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    const types: unknown[] = []
    const { ctx, generate } = fakeCtx(turn())
    Object.assign(ctx, {
      options: { enabled: true },
      location: { directory: "/repo" },
      session: {
        ...ctx.session,
        get: async ({ sessionID }: { sessionID: string }) => ({
          id: sessionID,
          location: { directory: sessionID === "ses_1" ? "/repo" : "/other" },
        }),
      },
      event: {
        subscribe: (options: { types?: unknown[] }) => {
          types.push(...(options.types ?? []))
          return (async function* () {
            yield { type: "session.execution.succeeded", data: { sessionID: "ses_2" } }
            yield { type: "session.execution.succeeded", data: { sessionID: "ses_1" } }
          })()
        },
      },
    })
    const cleanup = await plugin.setup(ctx as never)
    await waitFor(() => rowLines(file).length === 1)
    if (typeof cleanup === "function") await cleanup()
    assert.deepEqual(types, ["session.execution.succeeded"])
    assert.equal(generate.length, 1)
    assert.equal(rowLines(file).length, 1)
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
  }
})

for (const [label, options, expected] of [
  ["missing", undefined, 0],
  ["empty", {}, 0],
  ["disabled", { enabled: false }, 0],
  ["non-boolean", { enabled: "true" }, 0],
  ["enabled", { enabled: true }, 1],
] as const) {
  test(`setup subscribes only with enabled options (${label})`, async () => {
    let subscriptions = 0
    await plugin.setup({
      options,
      event: {
        subscribe: () => {
          subscriptions++
          return (async function* () {})()
        },
      },
    } as never)
    assert.equal(subscriptions, expected)
  })
}
