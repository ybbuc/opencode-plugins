import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

const OllamaWindow = Schema.Struct({ remainingPercent: Schema.Number, resetsAt: Schema.String })

export const OllamaBalance = Schema.Struct({
  session: Schema.optional(OllamaWindow),
  weekly: Schema.optional(OllamaWindow),
  purchasedUsd: Schema.Number,
})

export type OllamaBalance = typeof OllamaBalance.Type

// main fetches ollama.com: the window cannot, since the API sends no CORS headers.
export const OllamaBalanceService = Ipc.define({
  id: "quota.ollama",
  methods: { balance: { input: Schema.String, output: OllamaBalance } },
})

const UsageMeter = Schema.Struct({ usedPercent: Schema.Number, resetsAt: Schema.Number })

export const ChatGptUsage = Schema.Struct({
  session: Schema.optional(UsageMeter),
  weekly: Schema.optional(UsageMeter),
})

export type ChatGptUsage = typeof ChatGptUsage.Type

// chatgpt.com needs the OAuth token and a non-browser User-Agent, so it cannot run in the window either.
export const ChatGptUsageService = Ipc.define({
  id: "quota.chatgpt",
  methods: { usage: { input: Schema.Struct({ access: Schema.String, accountID: Schema.String }), output: ChatGptUsage } },
})
