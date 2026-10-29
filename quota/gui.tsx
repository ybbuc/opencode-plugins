import { ComposerPill, Plugin, Style } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"
import { Balance, type Ollama } from "./usage.ts"

const clock = (date: Date) => `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`
const used = (remaining: number) => Math.round(100 - remaining)
// Rows render in the pill's proportional sans font, where padded character counts do not line up.
// Monospace makes the bar columns meet; nbsp survives HTML whitespace collapsing.
const css = `[data-slot="session-plugin-pill-row"] { font-family: var(--v2-font-family-code) }`

const NBSP = "\u00A0"

const row = (percent: number) => (name: string) =>
  `${name.padEnd(7, NBSP)}${NBSP}${bar(percent)}${NBSP}${percent}%`
const bar = (percent: number) => {
  const filled = Math.max(0, Math.min(10, Math.round(percent / 10)))
  return "▮".repeat(filled) + "▯".repeat(10 - filled)
}

type Credential = { integrationID: string; value: { type: string; key?: string } }
type Included = { remaining_percent: number; resets_at: string }
type GoWindow = { percent: number; resetsAt: number; limited: boolean }
type Go = { rolling?: GoWindow; weekly?: GoWindow; monthly?: GoWindow }

export default Plugin.define({
  main(ctx) {
    ctx.provide(Balance, {
      balance: async (key) => {
        const response = await fetch("https://ollama.com/api/balance", {
          headers: { authorization: `Bearer ${key}` },
        })
        if (!response.ok) throw new Error(`ollama.com answered ${response.status}`)

        const body = (await response.json()) as {
          included?: { session?: Included; weekly?: Included }
          purchased?: { balance_usd?: number }
        }
        const window = (value?: Included) =>
          value && { remaining: value.remaining_percent, resetsAt: value.resets_at }

        const session = window(body.included?.session)
        const weekly = window(body.included?.weekly)

        return {
          purchased: body.purchased?.balance_usd ?? 0,
          ...(session ? { session } : {}),
          ...(weekly ? { weekly } : {}),
        }
      },
    })
  },

  setup(ctx) {
    ctx.add(Style, css)

    const [ollama, setOllama] = createSignal<Ollama | undefined>()
    const [go, setGo] = createSignal<Go | undefined>()
    const balance = ctx.main(Balance)

    const load = async () => {
      try {
        const limits = (await ctx.client.experimental.usage.limits()) as unknown as { go?: Go }
        setGo(limits.go)
      } catch {
        // Keep the last reading.
      }

      try {
        const entries = (await ctx.client.credential.list()) as unknown as Credential[]
        const key = entries.find((entry) => entry.integrationID === "ollama-cloud" && entry.value?.type === "key")?.value.key
        if (key) setOllama(await balance.balance(key))
      } catch {
        // Keep the last reading.
      }
    }

    void load()
    const refresh = setInterval(() => void load(), 5 * 60_000)
    onCleanup(() => clearInterval(refresh))

    const rows = () => {
      const list = []
      const value = go()

      if (value?.rolling) list.push({ id: "go.rolling", label: row(value.rolling.percent)("Go 5h"), detail: `resets ${clock(new Date(value.rolling.resetsAt))}` })
      if (value?.weekly) list.push({ id: "go.weekly", label: row(value.weekly.percent)("Go 7d"), detail: `resets ${clock(new Date(value.weekly.resetsAt))}` })
      if (value?.monthly) list.push({ id: "go.monthly", label: row(value.monthly.percent)("Go 30d"), detail: `resets ${clock(new Date(value.monthly.resetsAt))}` })

      const account = ollama()
      if (account?.session) list.push({ id: "ollama.session", label: row(used(account.session.remaining))("Session"), detail: `resets ${clock(new Date(account.session.resetsAt))}` })
      if (account?.weekly) list.push({ id: "ollama.weekly", label: row(used(account.weekly.remaining))("Weekly"), detail: `resets ${clock(new Date(account.weekly.resetsAt))}` })
      if (account && account.purchased > 0) list.push({ id: "ollama.credits", label: `$${account.purchased.toFixed(2)} purchased credits` })

      return list.length > 0 ? list : undefined
    }

    ctx.add(ComposerPill, {
      id: "quota",
      show: (input) => {
        if (input.screen.composer.model()?.providerID !== "ollama-cloud") return

        const parts: string[] = []
        const account = ollama()

        if (account?.session) parts.push(`session ${used(account.session.remaining)}%`)
        if (account?.weekly) parts.push(`weekly ${used(account.weekly.remaining)}%`)
        if (parts.length === 0) return

        return { label: parts.join(" · "), title: "Usage", rows: rows() }
      },
    })
  },
})
