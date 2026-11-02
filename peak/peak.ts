// Peak windows, both in UTC:
//   ollama:     https://ollama.com/pricing — "outside 12:00 and 18:00 UTC on weekdays"
//   opencode:   https://opencode.ai/v2/docs/console/go/ — "01:00-04:00 and 06:00-10:00 UTC"
// Weekends are off-peak for both.

export type Window = readonly [startHour: number, endHour: number]

export interface PeakStatus {
  readonly peak: boolean
  /** When the next phase starts. */
  readonly until: Date
}

const HOUR = 3_600_000
const DAY = 86_400_000

const PRICING: Record<string, { windows: readonly Window[]; models: readonly string[] }> = {
  "ollama-cloud": { windows: [[12, 18]], models: ["deepseek-v4.1-flash", "deepseek-v4-pro"] },
  "opencode-go": { windows: [[1, 4], [6, 10]], models: ["deepseek-v4.1-flash", "deepseek-v4-pro"] },
}

const transitions = (from: Date, windows: readonly Window[]) => {
  const base = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const out: { at: number; peak: boolean }[] = []

  for (let day = 0; day < 8; day++) {
    const start = base + day * DAY
    const dow = new Date(start).getUTCDay()
    if (dow === 0 || dow === 6) continue

    for (const [open, close] of windows) {
      out.push({ at: start + open * HOUR, peak: true })
      out.push({ at: start + close * HOUR, peak: false })
    }
  }

  return out.sort((a, b) => a.at - b.at)
}

/** Peak state for a provider and model, or undefined when the model has no peak pricing. */
export function status(now: Date, providerID: string, modelID: string): PeakStatus | undefined {
  const pricing = PRICING[providerID]
  if (!pricing?.models.some((model) => modelID.startsWith(model))) return

  let peak = false
  let until = now.getTime()

  for (const at of transitions(now, pricing.windows)) {
    if (at.at <= now.getTime()) {
      peak = at.peak
      until = at.at
      continue
    }

    until = at.at
    break
  }

  return { peak, until: new Date(until) }
}

/** "2d 6h", "2h 14m", "38m", "<1m". */
export function remaining(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return "<1m"
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`

  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`
}
