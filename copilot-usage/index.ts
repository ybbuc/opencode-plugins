import { logTurn } from "./log.ts"
import type { Plugin } from "@opencode/plugin"

export default {
  id: "copilot-usage",

  async setup(ctx) {
    if (ctx.options?.enabled !== true) return
    const controller = new AbortController()
    const logged = new Set<string>()
    void (async () => {
      for await (const event of ctx.event.subscribe({ types: ["session.execution.succeeded"], signal: controller.signal })) {
        void logTurn(ctx, event.data.sessionID, logged, undefined, undefined, controller.signal, ctx.location).catch(() => {
          if (!controller.signal.aborted) console.error("copilot-usage: turn not logged")
        })
      }
    })().catch(() => {
      if (!controller.signal.aborted) console.error("copilot-usage: event stream stopped")
    })
    return () => controller.abort()
  },
} satisfies Plugin.Plugin
