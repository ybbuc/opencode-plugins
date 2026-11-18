import assert from "node:assert/strict"
import { test } from "node:test"
import { Host } from "@opencode/plugin/host"
import type { Plugin } from "@opencode/plugin/tui"
import type { DialogSelectOptions, KeymapCommand, KeymapLayer, SlotClaim, ToastOptions } from "@opencode/plugin/tui/context"
import quickLinks from "./tui.ts"

test("loads through a local directory", async () => {
  const { tui } = Host.resolve({ directory: import.meta.dirname })
  if (!tui) throw new Error("Missing local TUI entrypoint")
  const loaded = await Host.load(tui) as { default: unknown }
  assert.equal(loaded.default, quickLinks)
})

for (const { label, options, bind } of [
  { label: "no shortcut by default", options: {}, bind: false },
  { label: "configured shortcut", options: { keybind: "ctrl+shift+o" }, bind: "ctrl+shift+o" },
  { label: "different shortcut", options: { keybind: "alt+l" }, bind: "alt+l" },
  { label: "disabled shortcut", options: { keybind: false }, bind: false },
  { label: "none shortcut", options: { keybind: "none" }, bind: false },
]) {
  test(`reads and deduplicates text links, excluding tool calls, with ${label}`, async () => {
    let command!: KeymapCommand | undefined
    let dialog: DialogSelectOptions<string> | undefined
    let render!: SlotClaim<"app">["render"]
    let mounted = false
    let disposed = false
    const messages: ReturnType<Plugin.Context["data"]["session"]["message"]["list"]> = []
    const cleanup = await quickLinks.setup({
      options,
      keymap: { layer: (get: () => KeymapLayer) => {
        assert.equal(mounted, true)
        command = get().commands?.[0]
      } },
      data: { session: { message: {
        sync: async (sessionID: string) => {
          assert.equal(sessionID, "session")
          messages.push(
            { id: "user", time: { created: 0 }, type: "user", text: "See https://example.com/guide." },
            { id: "assistant", time: { created: 0 }, type: "assistant", agent: "build", model: { providerID: "test", id: "test" }, content: [
              { type: "text", text: "[Guide](https://example.com/guide) and https://example.com/page_(one)." },
              { type: "text", text: "**[PR](https://github.com/anomalyco/opencode-console/pull/2090)**" },
              { type: "text", text: "[Guide](https://example.com/guide)follow-up(foo) **https://example.com/guide**" },
              { type: "text", text: "**[Nested](https://example.com/page_(one_(two))/details)**" },
              { type: "reasoning", text: "https://private.example/reasoning" },
              { type: "tool", id: "tool", name: "test", time: { created: 0 }, state: { status: "completed", input: {}, content: [{ type: "text", text: "https://example.com/tool https://example.com/guide" }] } },
              { type: "tool", id: "failed", name: "test", time: { created: 0 }, state: { status: "error", input: {}, error: { type: "test", message: "failed" }, content: [{ type: "text", text: "https://example.com/error" }] } },
              { type: "tool", id: "running", name: "test", time: { created: 0 }, state: { status: "running", input: { url: "https://private.example/input" }, metadata: {} } },
            ] },
            { id: "synthetic", time: { created: 0 }, type: "synthetic", text: "https://private.example/synthetic" },
            { id: "system", time: { created: 0 }, type: "system", text: "https://private.example/system" },
          )
        },
        list: () => messages,
      } } },
      ui: {
        slot: (claim: SlotClaim<"app">) => {
          assert.equal(claim.append, "app")
          render = claim.render
          return () => { disposed = true }
        },
        router: { current: () => ({ type: "session", sessionID: "session" }) },
        toast: { show: (input: ToastOptions) => { throw new Error(input.message) } },
        dialog: { select: async (input: DialogSelectOptions<string>) => { dialog = input } },
      },
    } as unknown as Plugin.Context)
    assert.equal<KeymapCommand | undefined>(command, undefined)
    mounted = true
    render({})
    if (!command) throw new Error("Quick Links command was not registered")
    assert.equal(command.id, "quick-links.open")
    assert.equal(command.bind, bind)
    assert.equal(command.slash?.name, "links")
    await command.run()
    assert.equal(dialog?.placeholder, "Search links in the conversation")
    assert.deepEqual(dialog?.options, [
      { title: "Nested", description: "example.com/page_(one_(two))/details", value: "https://example.com/page_(one_(two))/details" },
      { title: "Guide", description: "example.com/guide", value: "https://example.com/guide" },
      { title: "PR", description: "github.com/anomalyco/opencode-console/pull/2090", value: "https://github.com/anomalyco/opencode-console/pull/2090" },
      { title: "example.com/page_(one)", value: "https://example.com/page_(one)" },
    ])
    assert.deepEqual(dialog?.options.map((option) => option.value), [
      "https://example.com/page_(one_(two))/details",
      "https://example.com/guide",
      "https://github.com/anomalyco/opencode-console/pull/2090",
      "https://example.com/page_(one)",
    ])
    if (cleanup) await cleanup()
    assert.equal(disposed, true)
  })
}

for (const keybind of [true, 42, "", "   "]) {
  test(`rejects invalid keybind option ${JSON.stringify(keybind)}`, () => {
    assert.throws(() => quickLinks.setup({ options: { keybind } } as unknown as Plugin.Context), {
      message: "opencode-quick-links keybind option must be a non-empty string or false",
    })
  })
}
