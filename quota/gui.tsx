import { ComposerPill, Plugin, Style } from "@opencode/plugin/gui"
import { createSignal, onCleanup } from "solid-js"
import { formatRemainingTime } from "../peak/peak.ts"
import { CHATGPT_USAGE_URL, parse as parseChatGpt } from "./chatgpt.ts"
import { loadUsage as loadClaudeUsage, type ClaudeUsage } from "./claude.ts"
import { projectDailyUsage, projectMonthlyUsage } from "./pace.ts"
import { ChatGptUsageService, ClaudeUsageService, OllamaBalanceService, type ChatGptUsage, type OllamaBalance } from "./usage.ts"

const toUsedPercent = (remainingPercent: number) => Math.round(100 - remainingPercent)
// A date-only reset ("2026-11-01") means local midnight, not UTC.
const midnight = (date: string) => new Date(`${date}T00:00:00`).getTime()
// Rows render in the pill's proportional sans font, where padded character counts do not line up.
// Monospace makes the bar columns meet; nbsp survives HTML whitespace collapsing.
const css = `[data-slot="session-plugin-pill-row"] { font-family: var(--v2-font-family-code) }`

const NBSP = "\u00A0"

const formatUsageRow = (usedPercent: number) => (name: string) =>
  `${name.padEnd(7, NBSP)}${NBSP}${formatUsageBar(usedPercent)}${NBSP}${`${Math.round(usedPercent)}%`.padStart(4, NBSP)}`
const formatUsageBar = (usedPercent: number) => {
  const filled = Math.max(0, Math.min(10, Math.round(usedPercent / 10)))
  return "▮".repeat(filled) + "▯".repeat(10 - filled)
}

type Credential = {
  integrationID: string
  value: { type: string; key?: string; access?: string; metadata?: { accountID?: string } }
}
type CopilotUsage = { usedPercent: number; plan?: string; resetsAt: number }
type OllamaIncludedWindow = { remaining_percent: number; resets_at: string }
type GoWindow = { percent: number; resetsAt: number; limited: boolean }
type GoUsage = { rolling?: GoWindow; weekly?: GoWindow; monthly?: GoWindow }

const providerNames: Record<string, string> = {
  "opencode-go": "OpenCode Go",
  "ollama-cloud": "Ollama Cloud",
  "github-copilot": "GitHub Copilot",
  openai: "OpenAI",
  "claude-agent": "Claude",
}

export default Plugin.define({
  main(ctx) {
    ctx.provide(ClaudeUsageService, { usage: loadClaudeUsage })

    ctx.provide(OllamaBalanceService, {
      balance: async (key) => {
        const response = await fetch("https://ollama.com/api/balance", {
          headers: { authorization: `Bearer ${key}` },
        })
        if (!response.ok) throw new Error(`ollama.com answered ${response.status}`)

        const body = (await response.json()) as {
          included?: { session?: OllamaIncludedWindow; weekly?: OllamaIncludedWindow }
          purchased?: { balance_usd?: number }
        }
        const readWindow = (value?: OllamaIncludedWindow) =>
          value && { remainingPercent: value.remaining_percent, resetsAt: value.resets_at }

        const session = readWindow(body.included?.session)
        const weekly = readWindow(body.included?.weekly)

        return {
          purchasedUsd: body.purchased?.balance_usd ?? 0,
          ...(session ? { session } : {}),
          ...(weekly ? { weekly } : {}),
        }
      },
    })

    ctx.provide(ChatGptUsageService, {
      usage: async ({ access, accountID }) => {
        const response = await fetch(CHATGPT_USAGE_URL, {
          headers: {
            authorization: `Bearer ${access}`,
            "chatgpt-account-id": accountID,
            originator: "opencode",
            "user-agent": "opencode",
          },
        })
        if (!response.ok) throw new Error(`chatgpt.com answered ${response.status}`)

        return parseChatGpt(await response.json())
      },
    })
  },

  setup(ctx) {
    ctx.add(Style, css)

    const [ollama, setOllama] = createSignal<OllamaBalance | undefined>()
    const [go, setGo] = createSignal<GoUsage | undefined>()
    const [copilot, setCopilot] = createSignal<CopilotUsage | undefined>()
    const [chatGptReading, setChatGptReading] = createSignal<ChatGptUsage | undefined>()
    const [claude, setClaude] = createSignal<ClaudeUsage>()
    // Read by the rows: a countdown is only right if it ticks.
    const [now, setNow] = createSignal(Date.now())
    const balance = ctx.main(OllamaBalanceService)
    const chatGptUsage = ctx.main(ChatGptUsageService)
    const claudeUsage = ctx.main(ClaudeUsageService)

    const load = async () => {
      try {
        const limits = (await ctx.client.experimental.usage.limits()) as unknown as { data: { go?: GoUsage } | null }
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

      if (entries.some((entry) => entry.integrationID === "claude-agent" && entry.value?.type === "external")) {
        try {
          setClaude(await claudeUsage.usage())
        } catch {
          // Keep the last reading.
        }
      }

      const ollamaKey = entries.find((entry) => entry.integrationID === "ollama-cloud" && entry.value?.type === "key")?.value.key
      if (ollamaKey) {
        try {
          setOllama(await balance.balance(ollamaKey))
        } catch {
          // Keep the last reading.
        }
      }

      const copilotToken = entries.find((entry) => entry.integrationID === "github-copilot" && entry.value?.type === "oauth")?.value.access
      if (copilotToken) {
        try {
          const response = await fetch("https://api.github.com/copilot_internal/user", {
            headers: { authorization: `token ${copilotToken}`, accept: "application/json" },
          })
          if (response.ok) {
            const body = (await response.json()) as {
              copilot_plan?: string
              quota_snapshots?: { premium_interactions?: { percent_remaining?: number; unlimited?: boolean } }
              quota_reset_date?: string
              quota_reset_date_utc?: string
            }
            const premium = body.quota_snapshots?.premium_interactions
            if (premium && !premium.unlimited && typeof premium.percent_remaining === "number") {
              const resetsAt = body.quota_reset_date_utc
                ? Date.parse(body.quota_reset_date_utc)
                : midnight(body.quota_reset_date ?? "")
              setCopilot({ usedPercent: toUsedPercent(premium.percent_remaining), plan: body.copilot_plan, resetsAt })
            }
          }
        } catch {
          // Keep the last reading.
        }
      }

      // Only the Codex login yields a chatgpt.com token plus the account ID the usage endpoint wants.
      const chatGptCredential = entries.find(
        (entry) => entry.integrationID === "openai" && entry.value?.type === "oauth" && entry.value.metadata?.accountID,
      )
      const access = chatGptCredential?.value.access
      const accountID = chatGptCredential?.value.metadata?.accountID
      if (access && accountID) {
        try {
          setChatGptReading(await chatGptUsage.usage({ access, accountID }))
        } catch {
          // Keep the last reading.
        }
      }
    }

    void load()
    const refresh = setInterval(() => void load(), 5 * 60_000)
    const tick = setInterval(() => setNow(Date.now()), 60_000)
    onCleanup(() => {
      clearInterval(refresh)
      clearInterval(tick)
    })

    const formatResetCountdown = (at: number) => (Number.isFinite(at) ? `resets in ${formatRemainingTime(at - now())}` : "")
    // The window's position already implies its name, so the time until reset says more.
    const windowLabel = (name: string, resetsAt: number) =>
      Number.isFinite(resetsAt) ? formatRemainingTime(resetsAt - now()) : name

    const rows = (provider: string | undefined) => {
      const list = []

      if (provider === "opencode-go") {
        const value = go()
        if (value?.rolling) list.push({ id: "go.rolling", label: formatUsageRow(value.rolling.percent)("Session"), detail: formatResetCountdown(value.rolling.resetsAt) })
        if (value?.weekly) list.push({ id: "go.weekly", label: formatUsageRow(value.weekly.percent)("Weekly"), detail: formatResetCountdown(value.weekly.resetsAt) })
        if (value?.monthly) list.push({ id: "go.monthly", label: formatUsageRow(value.monthly.percent)("Monthly"), detail: formatResetCountdown(value.monthly.resetsAt) })
      } else if (provider === "ollama-cloud") {
        const account = ollama()
        if (account?.session) list.push({ id: "ollama.session", label: formatUsageRow(toUsedPercent(account.session.remainingPercent))("Session"), detail: formatResetCountdown(new Date(account.session.resetsAt).getTime()) })
        if (account?.weekly) list.push({ id: "ollama.weekly", label: formatUsageRow(toUsedPercent(account.weekly.remainingPercent))("Weekly"), detail: formatResetCountdown(new Date(account.weekly.resetsAt).getTime()) })
        if (account && account.purchasedUsd > 0) list.push({ id: "ollama.credits", label: `$${account.purchasedUsd.toFixed(2)} purchased credits` })
      } else if (provider === "github-copilot") {
        const premium = copilot()
        if (premium) list.push({ id: "copilot.premium", label: formatUsageRow(premium.usedPercent)("Credits"), detail: formatResetCountdown(premium.resetsAt) })
      } else if (provider === "openai" || provider === "claude-agent") {
        const value = provider === "claude-agent" ? claude() : chatGptReading()
        if (value?.session) list.push({ id: `${provider}.session`, label: formatUsageRow(value.session.usedPercent)("Session"), detail: formatResetCountdown(value.session.resetsAt) })
        if (value?.weekly) list.push({ id: `${provider}.weekly`, label: formatUsageRow(value.weekly.usedPercent)("Weekly"), detail: formatResetCountdown(value.weekly.resetsAt) })
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
          if (value?.rolling) parts.push(`${value.rolling.percent}% · ${windowLabel("session", value.rolling.resetsAt)}`)
          if (value?.weekly) parts.push(`${value.weekly.percent}% · ${windowLabel("weekly", value.weekly.resetsAt)}`)
          if (value?.monthly) parts.push(`${value.monthly.percent}% · ${windowLabel("monthly", value.monthly.resetsAt)}`)
        } else if (provider === "ollama-cloud") {
          const account = ollama()
          if (account?.session) {
            parts.push(`${toUsedPercent(account.session.remainingPercent)}% · ${windowLabel("session", Date.parse(account.session.resetsAt))}`)
          }
          if (account?.weekly) {
            const projected = projectDailyUsage(100 - account.weekly.remainingPercent, Date.parse(account.weekly.resetsAt), 7 * 86_400_000, now())
            parts.push(`${toUsedPercent(account.weekly.remainingPercent)}%${projected === undefined ? "" : ` → ${Math.round(projected)}%`} · ${windowLabel("weekly", Date.parse(account.weekly.resetsAt))}`)
          }
        } else if (provider === "github-copilot") {
          const premium = copilot()
          if (premium) {
            const projected = projectMonthlyUsage(premium.usedPercent, premium.resetsAt, now())
            parts.push(`${premium.usedPercent}%${projected === undefined ? "" : ` → ${Math.round(projected)}%`} · ${windowLabel("credits", premium.resetsAt)}`)
          }
        } else if (provider === "openai" || provider === "claude-agent") {
          const value = provider === "claude-agent" ? claude() : chatGptReading()
          if (value?.session) parts.push(`${value.session.usedPercent}% · ${windowLabel("session", value.session.resetsAt)}`)
          if (value?.weekly) {
            const projected = projectDailyUsage(value.weekly.usedPercent, value.weekly.resetsAt, 7 * 86_400_000, now())
            parts.push(`${value.weekly.usedPercent}%${projected === undefined ? "" : ` → ${Math.round(projected)}%`} · ${windowLabel("weekly", value.weekly.resetsAt)}`)
          }
        }

        if (parts.length === 0) return
        const name = provider ? providerNames[provider] : undefined
        const plan = provider === "github-copilot" ? copilot()?.plan : undefined
        return { label: parts.join(" | "), title: `${name ?? "Provider"} Usage${plan ? ` (${plan})` : ""}`, rows: rows(provider) }
      },
    })
  },
})
