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
