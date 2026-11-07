// Peak windows, both in UTC:
//   ollama:     https://ollama.com/pricing — "outside 12:00 and 18:00 UTC on weekdays"
//   opencode:   https://opencode.ai/v2/docs/console/go/ — "01:00-04:00 and 06:00-10:00 UTC"
// Weekends are off-peak for both.

export type PeakWindow = readonly [startHour: number, endHour: number]

export interface PeakStatus {
  readonly isPeak: boolean
  /** When the next phase starts. */
  readonly nextTransitionAt: Date
}

const HOUR = 3_600_000
const DAY = 86_400_000

const PRICING: Record<string, { windows: readonly PeakWindow[]; models: readonly string[] }> = {
  "ollama-cloud": { windows: [[12, 18]], models: ["deepseek-v4.1-flash", "deepseek-v4-pro"] },
  "opencode-go": { windows: [[1, 4], [6, 10]], models: ["deepseek-v4.1-flash", "deepseek-v4-pro"] },
}

const transitions = (from: Date, windows: readonly PeakWindow[]) => {
  const base = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const out: { at: number; isPeak: boolean }[] = []

  for (let day = 0; day < 8; day++) {
    const start = base + day * DAY
    const weekday = new Date(start).getUTCDay()
    if (weekday === 0 || weekday === 6) continue

    for (const [open, close] of windows) {
      out.push({ at: start + open * HOUR, isPeak: true })
      out.push({ at: start + close * HOUR, isPeak: false })
    }
  }

  return out.sort((a, b) => a.at - b.at)
}

/** Peak state for a provider and model, or undefined when the model has no peak pricing. */
export function status(now: Date, providerID: string, modelID: string): PeakStatus | undefined {
  const pricing = PRICING[providerID]
  if (!pricing?.models.some((model) => modelID.startsWith(model))) return

  let isPeak = false
  let nextTransitionAt = now.getTime()

  for (const transition of transitions(now, pricing.windows)) {
    if (transition.at <= now.getTime()) {
      isPeak = transition.isPeak
      nextTransitionAt = transition.at
      continue
    }

    nextTransitionAt = transition.at
    break
  }

  return { isPeak, nextTransitionAt: new Date(nextTransitionAt) }
}

/** "2d 6h", "2h 14m", "38m", "<1m". */
export function formatRemainingTime(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return "<1m"
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`

  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}
