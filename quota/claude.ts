import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

export type ClaudeUsage = {
  session?: { usedPercent: number; resetsAt: number }
  weekly?: { usedPercent: number; resetsAt: number }
}

// The GUI receives this error across IPC, so match the message rather than the class.
export const isLoginError = (error: unknown) =>
  String(error instanceof Error ? error.message : error).includes("Claude Code login is")

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
let refreshRetryAt = 0

// Claude Code is the only writer of its login: it rotates the refresh token, so a
// second refresher would invalidate the stored one. Asking the CLI refreshes in place.
async function refreshLogin(): Promise<void> {
  if (Date.now() < refreshRetryAt) throw new Error("Claude Code login refresh is backing off")
  const path = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin")].filter(Boolean).join(":")
  try {
    await promisify(execFile)("claude", ["auth", "status"], { timeout: 30_000, env: { ...process.env, PATH: path } })
  } catch (error) {
    // A dead refresh token needs an interactive login, so stop spawning the CLI every refresh.
    refreshRetryAt = Date.now() + 60 * 60_000
    throw error
  }
}

export async function loadUsage(): Promise<ClaudeUsage> {
  if (Date.now() < retryAt) throw new Error("Claude usage is rate-limited")
  let oauth = JSON.parse(await credentials())?.claudeAiOauth
  if (typeof oauth?.expiresAt === "number" && oauth.expiresAt < Date.now()) {
    await refreshLogin()
    oauth = JSON.parse(await credentials())?.claudeAiOauth
  }
  if (typeof oauth?.accessToken !== "string" || !oauth.accessToken) throw new Error("Claude Code login is unavailable")
  // A revoked login survives the CLI refresh untouched, and Claude answers an expired token with a
  // long throttling window, so sending one buys nothing.
  if (typeof oauth.expiresAt === "number" && oauth.expiresAt < Date.now()) throw new Error("Claude Code login is expired")
  const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      authorization: `Bearer ${oauth.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "user-agent": "opencode-quota",
    },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 429) {
    // Retry-After is in seconds.
    const retryAfter = Number(response.headers.get("retry-after")) * 1_000
    retryAt = Date.now() + (retryAfter > 0 ? retryAfter : 30 * 60_000)
  }
  if (!response.ok) throw new Error(`Claude usage answered ${response.status}`)
  return parse(await response.json())
}
