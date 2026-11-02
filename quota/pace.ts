const add = (date: Date, days: number) => {
  const moved = new Date(date)
  moved.setDate(moved.getDate() + days)
  return moved
}

/** Gregorian Easter Sunday. */
const easter = (year: number) => {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  return new Date(year, month - 1, ((h + l - 7 * m + 114) % 31) + 1)
}

/** North Rhine-Westphalia's public holidays for a year. */
const holidays = (year: number) => {
  const sunday = easter(year)
  return [
    new Date(year, 0, 1),
    add(sunday, -2),
    add(sunday, 1),
    new Date(year, 4, 1),
    add(sunday, 39),
    add(sunday, 50),
    add(sunday, 60),
    new Date(year, 9, 3),
    new Date(year, 10, 1),
    new Date(year, 11, 25),
    new Date(year, 11, 26),
  ]
}

const key = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`

/** Counts workdays (weekdays without holidays) in [from, to). */
const workdays = (from: number, to: number) => {
  const off = new Set<string>()
  for (let year = new Date(from).getFullYear(); year <= new Date(to).getFullYear(); year++) {
    for (const day of holidays(year)) off.add(key(day))
  }

  let count = 0
  for (const day = new Date(from); day.getTime() < to; day.setDate(day.getDate() + 1)) {
    const weekday = day.getDay()
    if (weekday !== 0 && weekday !== 6 && !off.has(key(day))) count++
  }
  return count
}

/** Extrapolates a monthly window's used percentage to its reset, spending only on workdays. */
export function project(used: number, resetsAt: number, now: number): number | undefined {
  if (!Number.isFinite(resetsAt)) return
  const start = new Date(resetsAt)
  start.setUTCMonth(start.getUTCMonth() - 1)
  const from = start.getTime()
  const elapsed = workdays(from, now)
  const total = workdays(from, resetsAt)
  if (elapsed === 0 || elapsed >= total) return
  return (used * total) / elapsed
}

export function projectLinear(used: number, resetsAt: number, duration: number, now: number): number | undefined {
  if (![used, resetsAt, duration, now].every(Number.isFinite) || used < 0 || used > 100 || duration <= 0) return
  const elapsed = now - (resetsAt - duration)
  if (elapsed <= 0 || now >= resetsAt) return
  return (used * duration) / elapsed
}
