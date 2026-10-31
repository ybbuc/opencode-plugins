export interface Window {
  used_percent?: number
  reset_at?: number
  limit_window_seconds?: number
}

export interface Usage {
  session?: { used: number; resetsAt: number }
  weekly?: { used: number; resetsAt: number }
}

export const usageUrl = "https://chatgpt.com/backend-api/wham/usage"

/** ChatGPT reports the 5-hour and weekly windows in either slot, so classify by duration. */
export function parse(body: {
  rate_limit?: { primary_window?: Window | null; secondary_window?: Window | null }
}): Usage {
  const out: Usage = {}
  for (const window of [body.rate_limit?.primary_window, body.rate_limit?.secondary_window]) {
    if (typeof window?.used_percent !== "number") continue
    const key = (window.limit_window_seconds ?? 0) >= 86_400 ? "weekly" : "session"
    out[key] = { used: Math.round(window.used_percent), resetsAt: (window.reset_at ?? 0) * 1000 }
  }
  return out
}
