import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

const Window = Schema.Struct({ remaining: Schema.Number, resetsAt: Schema.String })

export const Ollama = Schema.Struct({
  session: Schema.optional(Window),
  weekly: Schema.optional(Window),
  purchased: Schema.Number,
})

export type Ollama = typeof Ollama.Type

// main fetches ollama.com: the window cannot, since the API sends no CORS headers.
export const Balance = Ipc.define({
  id: "quota.ollama",
  methods: { balance: { input: Schema.String, output: Ollama } },
})

const Meter = Schema.Struct({ used: Schema.Number, resetsAt: Schema.Number })

export const ChatGpt = Schema.Struct({
  session: Schema.optional(Meter),
  weekly: Schema.optional(Meter),
})

export type ChatGpt = typeof ChatGpt.Type

// chatgpt.com needs the OAuth token and a non-browser User-Agent, so it cannot run in the window either.
export const Usage = Ipc.define({
  id: "quota.chatgpt",
  methods: { usage: { input: Schema.Struct({ access: Schema.String, accountID: Schema.String }), output: ChatGpt } },
})
