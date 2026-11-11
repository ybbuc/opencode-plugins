/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { formatRemainingTime } from "../peak/peak.ts"
import { CHATGPT_USAGE_URL, parse as parseChatGpt, type ChatGptUsage } from "./chatgpt.ts"
import { loadUsage as loadClaudeUsage, type ClaudeUsage } from "./claude.ts"
import { projectMonthlyUsage } from "./pace.ts"

type GoWindow = { percent: number; resetsAt: number; limited: boolean }
type GoUsage = { rolling?: GoWindow; weekly?: GoWindow; monthly?: GoWindow }
type Credential = {
  integrationID: string
  value: { type: string; key?: string; access?: string; metadata?: { accountID?: string } }
}
type OllamaIncludedWindow = { remaining_percent: number; resets_at: string }
type OllamaWindow = { remainingPercent: number; resetsAt: string }
type OllamaBalance = { session?: OllamaWindow; weekly?: OllamaWindow; purchasedUsd: number }
type CopilotUsage = { usedPercent: number; resetsAt: number }
const toUsedPercent = (remainingPercent: number) => Math.round(100 - remainingPercent)
// Date-only resets mean local midnight, not UTC.
const midnight = (date: string) => new Date(`${date}T00:00:00`).getTime()

export default Plugin.define({
  id: "quota",
  setup(ctx) {
    const [go, setGo] = createSignal<GoUsage>()
    const [ollama, setOllama] = createSignal<OllamaBalance>()
    const [copilot, setCopilot] = createSignal<CopilotUsage>()
    const [chatGptReading, setChatGptReading] = createSignal<ChatGptUsage>()
    const [claude, setClaude] = createSignal<ClaudeUsage>()
    const [now, setNow] = createSignal(Date.now())

    // The terminal can reach these hosts directly, so it skips the GUI's IPC hop.
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
          setClaude(await loadClaudeUsage())
        } catch {
          // Keep the last reading.
        }
      }

      const ollamaKey = entries.find((entry) => entry.integrationID === "ollama-cloud" && entry.value?.type === "key")?.value.key
      if (ollamaKey) {
        try {
          const response = await fetch("https://ollama.com/api/balance", {
            headers: { authorization: `Bearer ${ollamaKey}` },
          })
          if (response.ok) {
            const body = (await response.json()) as {
              included?: { session?: OllamaIncludedWindow; weekly?: OllamaIncludedWindow }
              purchased?: { balance_usd?: number }
            }
            const readWindow = (value?: OllamaIncludedWindow) =>
              value && { remainingPercent: value.remaining_percent, resetsAt: value.resets_at }
            const session = readWindow(body.included?.session)
            const weekly = readWindow(body.included?.weekly)
            setOllama({ purchasedUsd: body.purchased?.balance_usd ?? 0, ...(session ? { session } : {}), ...(weekly ? { weekly } : {}) })
          }
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
              quota_snapshots?: { premium_interactions?: { percent_remaining?: number; unlimited?: boolean } }
              quota_reset_date?: string
              quota_reset_date_utc?: string
            }
            const premium = body.quota_snapshots?.premium_interactions
            if (premium && !premium.unlimited && typeof premium.percent_remaining === "number") {
              const resetsAt = body.quota_reset_date_utc
                ? Date.parse(body.quota_reset_date_utc)
                : midnight(body.quota_reset_date ?? "")
              setCopilot({ usedPercent: toUsedPercent(premium.percent_remaining), resetsAt })
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
          const response = await fetch(CHATGPT_USAGE_URL, {
            headers: {
              authorization: `Bearer ${access}`,
              "chatgpt-account-id": accountID,
              originator: "opencode",
              "user-agent": "opencode",
            },
          })
          if (response.ok) setChatGptReading(parseChatGpt(await response.json()))
        } catch {
          // Keep the last reading.
        }
      }
    }

    void load()
    const refresh = setInterval(() => void load(), 5 * 60_000)
    const tick = setInterval(() => setNow(Date.now()), 60_000)

    // The window's position already implies its name, so the time until reset says more.
    const windowLabel = (name: string, resetsAt: number) =>
      Number.isFinite(resetsAt) ? formatRemainingTime(resetsAt - now()) : name

    ctx.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const provider = ctx.ui.model.current()?.providerID
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
            parts.push(`${toUsedPercent(account.weekly.remainingPercent)}% · ${windowLabel("weekly", Date.parse(account.weekly.resetsAt))}`)
          }
        } else if (provider === "github-copilot") {
          const copilotUsage = copilot()
          if (copilotUsage) {
            const projected = projectMonthlyUsage(copilotUsage.usedPercent, copilotUsage.resetsAt, now())
            parts.push(`${copilotUsage.usedPercent}%${projected === undefined ? "" : ` → ${Math.round(projected)}%`} · ${windowLabel("credits", copilotUsage.resetsAt)}`)
          }
        } else if (provider === "openai" || provider === "claude-agent") {
          const value = provider === "claude-agent" ? claude() : chatGptReading()
          if (value?.session) parts.push(`${value.session.usedPercent}% · ${windowLabel("session", value.session.resetsAt)}`)
          if (value?.weekly) parts.push(`${value.weekly.usedPercent}% · ${windowLabel("weekly", value.weekly.resetsAt)}`)
        }

        return parts.length > 0 ? <text>{parts.join(" | ")}</text> : null
      },
    })

    return () => {
      clearInterval(refresh)
      clearInterval(tick)
    }
  },
})
