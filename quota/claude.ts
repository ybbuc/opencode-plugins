import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

export type ClaudeUsage = {
  session?: { usedPercent: number; resetsAt: number }
  weekly?: { usedPercent: number; resetsAt: number }
}

export function parse(body: unknown): ClaudeUsage {
  const out: ClaudeUsage = {}
  if (!body || typeof body !== "object") return out
  const windows = body as Record<string, { utilization?: unknown; resets_at?: unknown } | null>
  for (const [name, key] of [["session", "five_hour"], ["weekly", "seven_day"]] as const) {
    const value = windows[key]
    if (typeof value?.utilization !== "number" || !Number.isFinite(value.utilization) || value.utilization < 0 || value.utilization > 100) continue
    out[name] = {
      usedPercent: Math.round(value.utilization),
      resetsAt: typeof value.resets_at === "string" ? Date.parse(value.resets_at) : NaN,
    }
  }
  return out
}

async function credentials(): Promise<string> {
  const directory = process.env.CLAUDE_CONFIG_DIR
  if (process.platform === "darwin" && !directory) {
    try {
      const { stdout } = await promisify(execFile)("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { timeout: 5_000 })
      return stdout
    } catch {
      // Claude Code can fall back to file storage when Keychain is unavailable.
    }
  }
  return readFile(join(directory || join(homedir(), ".claude"), ".credentials.json"), "utf8")
}

// ponytail: backoff is process-local; persist it if multiple clients trigger throttling.
let retryAt = 0

export async function loadUsage(): Promise<ClaudeUsage> {
  if (Date.now() < retryAt) throw new Error("Claude usage is rate-limited")
  const oauth = JSON.parse(await credentials())?.claudeAiOauth
  if (typeof oauth?.accessToken !== "string" || !oauth.accessToken) throw new Error("Claude Code login is unavailable")
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      authorization: `Bearer ${oauth.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "user-agent": "opencode-quota",
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 429) retryAt = Date.now() + 30 * 60_000
  if (!response.ok) throw new Error(`Claude usage answered ${response.status}`)
  return parse(await response.json())
}
