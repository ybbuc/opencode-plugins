import { ComposerPill, Plugin, Style } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"
import { Balance, type Ollama } from "./usage.ts"

const clock = (date: Date) => `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`
const used = (remaining: number) => Math.round(100 - remaining)
const day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
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

type Credential = { integrationID: string; value: { type: string; key?: string; access?: string } }
type Copilot = { used: number; resets: string }
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
    const [copilot, setCopilot] = createSignal<Copilot | undefined>()
    const balance = ctx.main(Balance)

    const load = async () => {
      try {
        const limits = (await ctx.client.experimental.usage.limits()) as unknown as { data: { go?: Go } | null }
        setGo(limits.data?.go)
      } catch {
        // Keep the last reading.
      }

      let entries: Credential[] = []
      try {
        entries = (await ctx.client.credential.list()) as unknown as Credential[]
      } catch {
        return
      }

      const key = entries.find((entry) => entry.integrationID === "ollama-cloud" && entry.value?.type === "key")?.value.key
      if (key) {
        try {
          setOllama(await balance.balance(key))
        } catch {
          // Keep the last reading.
        }
      }

      const token = entries.find((entry) => entry.integrationID === "github-copilot" && entry.value?.type === "oauth")?.value.access
      if (token) {
        try {
          const response = await fetch("https://api.github.com/copilot_internal/user", {
            headers: { authorization: `token ${token}`, accept: "application/json" },
          })
          if (response.ok) {
            const body = (await response.json()) as {
              quota_snapshots?: { premium_interactions?: { percent_remaining?: number; unlimited?: boolean } }
              quota_reset_date?: string
            }
            const premium = body.quota_snapshots?.premium_interactions
            if (premium && !premium.unlimited && typeof premium.percent_remaining === "number") {
              setCopilot({ used: used(premium.percent_remaining), resets: body.quota_reset_date ?? "" })
            }
          }
        } catch {
          // Keep the last reading.
        }
      }
    }

    void load()
    const refresh = setInterval(() => void load(), 5 * 60_000)
    onCleanup(() => clearInterval(refresh))

    const rows = (provider: string | undefined) => {
      const list = []

      if (provider === "opencode-go") {
        const value = go()
        if (value?.rolling) list.push({ id: "go.rolling", label: row(value.rolling.percent)("Session"), detail: `resets ${clock(new Date(value.rolling.resetsAt))}` })
        if (value?.weekly) list.push({ id: "go.weekly", label: row(value.weekly.percent)("Weekly"), detail: `resets ${clock(new Date(value.weekly.resetsAt))}` })
        if (value?.monthly) list.push({ id: "go.monthly", label: row(value.monthly.percent)("Monthly"), detail: `resets ${clock(new Date(value.monthly.resetsAt))}` })
      } else if (provider === "ollama-cloud") {
        const account = ollama()
        if (account?.session) list.push({ id: "ollama.session", label: row(used(account.session.remaining))("Session"), detail: `resets ${clock(new Date(account.session.resetsAt))}` })
        if (account?.weekly) list.push({ id: "ollama.weekly", label: row(used(account.weekly.remaining))("Weekly"), detail: `resets ${clock(new Date(account.weekly.resetsAt))}` })
        if (account && account.purchased > 0) list.push({ id: "ollama.credits", label: `$${account.purchased.toFixed(2)} purchased credits` })
      } else if (provider === "github-copilot") {
        const premium = copilot()
        if (premium) list.push({ id: "copilot.premium", label: row(premium.used)("Credits"), detail: `resets ${day(premium.resets)}` })
      }

      return list.length > 0 ? list : undefined
    }

    ctx.add(ComposerPill, {
      id: "quota",
      show: (input) => {
        const provider = input.screen.composer.model()?.providerID
        const parts: string[] = []

        if (provider === "opencode-go") {
          const value = go()
          if (value?.rolling) parts.push(`session ${value.rolling.percent}%`)
          if (value?.weekly) parts.push(`weekly ${value.weekly.percent}%`)
          if (value?.monthly) parts.push(`monthly ${value.monthly.percent}%`)
        } else if (provider === "ollama-cloud") {
          const account = ollama()
          if (account?.session) parts.push(`session ${used(account.session.remaining)}%`)
          if (account?.weekly) parts.push(`weekly ${used(account.weekly.remaining)}%`)
        } else if (provider === "github-copilot") {
          const premium = copilot()
          if (premium) parts.push(`credits ${premium.used}%`)
        }

        if (parts.length === 0) return
        return { label: parts.join(" · "), title: "Usage", rows: rows(provider) }
      },
    })
  },
})
