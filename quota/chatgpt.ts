export interface ChatGptWindow {
  used_percent?: number
  reset_at?: number
  limit_window_seconds?: number
}

export interface ChatGptUsage {
  session?: { usedPercent: number; resetsAt: number }
  weekly?: { usedPercent: number; resetsAt: number }
}

export const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

/** ChatGPT reports the 5-hour and weekly windows in either slot, so classify by duration. */
export function parse(body: {
  rate_limit?: { primary_window?: ChatGptWindow | null; secondary_window?: ChatGptWindow | null }
}): ChatGptUsage {
  const out: ChatGptUsage = {}
  for (const rawWindow of [body.rate_limit?.primary_window, body.rate_limit?.secondary_window]) {
    if (typeof rawWindow?.used_percent !== "number") continue
    const windowName = (rawWindow.limit_window_seconds ?? 0) >= 86_400 ? "weekly" : "session"
    out[windowName] = { usedPercent: Math.round(rawWindow.used_percent), resetsAt: (rawWindow.reset_at ?? 0) * 1000 }
  }
  return out
}
