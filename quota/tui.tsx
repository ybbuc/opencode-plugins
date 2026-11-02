/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { parse as parseChatGpt, usageUrl, type Usage as ChatGpt } from "./chatgpt.ts"

type GoWindow = { percent: number; resetsAt: number; limited: boolean }
type Go = { rolling?: GoWindow; weekly?: GoWindow; monthly?: GoWindow }
type Credential = {
  integrationID: string
  value: { type: string; key?: string; access?: string; metadata?: { accountID?: string } }
}
type Included = { remaining_percent: number; resets_at: string }
type Ollama = { session?: { remaining: number }; weekly?: { remaining: number }; purchased: number }
const used = (percent: number) => Math.round(100 - percent)

export default Plugin.define({
  id: "quota",
  setup(ctx) {
    const [go, setGo] = createSignal<Go>()
    const [ollama, setOllama] = createSignal<Ollama>()
    const [copilot, setCopilot] = createSignal<number>()
    const [chatgpt, setChatGpt] = createSignal<ChatGpt>()

    // The terminal can reach these hosts directly, so it skips the GUI's IPC hop.
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
          const response = await fetch("https://ollama.com/api/balance", {
            headers: { authorization: `Bearer ${key}` },
          })
          if (response.ok) {
            const body = (await response.json()) as {
              included?: { session?: Included; weekly?: Included }
              purchased?: { balance_usd?: number }
            }
            const window = (value?: Included) => value && { remaining: value.remaining_percent }
            const session = window(body.included?.session)
            const weekly = window(body.included?.weekly)
            setOllama({ purchased: body.purchased?.balance_usd ?? 0, ...(session ? { session } : {}), ...(weekly ? { weekly } : {}) })
          }
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
            }
            const premium = body.quota_snapshots?.premium_interactions
            if (premium && !premium.unlimited && typeof premium.percent_remaining === "number") {
              setCopilot(used(premium.percent_remaining))
            }
          }
        } catch {
          // Keep the last reading.
        }
      }

      // Only the Codex login yields a chatgpt.com token plus the account ID the usage endpoint wants.
      const chatgpt = entries.find(
        (entry) => entry.integrationID === "openai" && entry.value?.type === "oauth" && entry.value.metadata?.accountID,
      )
      const access = chatgpt?.value.access
      const accountID = chatgpt?.value.metadata?.accountID
      if (access && accountID) {
        try {
          const response = await fetch(usageUrl, {
            headers: {
              authorization: `Bearer ${access}`,
              "chatgpt-account-id": accountID,
              originator: "opencode",
              "user-agent": "opencode",
            },
          })
          if (response.ok) setChatGpt(parseChatGpt(await response.json()))
        } catch {
          // Keep the last reading.
        }
      }
    }

    void load()
    const refresh = setInterval(() => void load(), 5 * 60_000)

    ctx.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const provider = ctx.ui.model.current()?.providerID
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
          const credits = copilot()
          if (credits !== undefined) parts.push(`credits ${credits}%`)
        } else if (provider === "openai") {
          const value = chatgpt()
          if (value?.session) parts.push(`session ${value.session.used}%`)
          if (value?.weekly) parts.push(`weekly ${value.weekly.used}%`)
        }

        return parts.length > 0 ? <text>{parts.join(" | ")}</text> : null
      },
    })

    return () => clearInterval(refresh)
  },
})
