import assert from "node:assert/strict"
import test from "node:test"
import { projectDailyUsage, projectMonthlyUsage } from "./pace.ts"

const reset = new Date(2026, 1, 1).getTime()
const at = (month: number, day: number) => new Date(2026, month, day, 12).getTime()

test("weekday holidays do not count toward the pace", () => {
  // January 2026 has 22 weekdays, New Year's Day among them; 11 of the rest have passed by the 16th.
  assert.equal(projectMonthlyUsage(66, reset, at(0, 16)), 126)
})

test("a weekend does not move the projection", () => {
  assert.equal(projectMonthlyUsage(66, reset, at(0, 18)), 126)
  assert.equal(Math.round(projectMonthlyUsage(66, reset, at(0, 19))!), 116)
})

test("a holiday at the window start leaves nothing elapsed", () => {
  assert.equal(projectMonthlyUsage(10, new Date(2026, 5, 1).getTime(), at(4, 1)), undefined)
})

test("movable holidays count, Corpus Christi included", () => {
  const july = new Date(2026, 6, 1).getTime()
  // June 2026 has 22 weekdays and Corpus Christi; three workdays have passed by Thursday the 4th.
  assert.equal(projectMonthlyUsage(7, july, at(5, 4)), 49)
})

test("no projection without a window", () => {
  assert.equal(projectMonthlyUsage(60, Number.NaN, at(0, 16)), undefined)
  assert.equal(projectMonthlyUsage(60, reset, new Date(2026, 0, 1).getTime()), undefined)
  assert.equal(projectMonthlyUsage(60, reset, reset), undefined)
})

test("linear projections count whole elapsed days", () => {
  const end = new Date(2026, 0, 8).getTime()
  const start = end - 604_800_000
  assert.equal(projectDailyUsage(1, end, 604_800_000, start + 86_400_000 - 1), 7)
  assert.equal(projectDailyUsage(1, end, 604_800_000, start + 86_400_000), 7)
  assert.equal(projectDailyUsage(40, end, 604_800_000, start + 3 * 86_400_000), (40 * 7) / 3)
  assert.equal(projectDailyUsage(0, end, 604_800_000, start + 86_400_000), 0)
})

test("the first day's usage is treated as a full day's usage", () => {
  const end = new Date(2026, 0, 8).getTime()
  const start = end - 604_800_000
  assert.equal(projectDailyUsage(1, end, 604_800_000, start), 7)
  assert.equal(projectDailyUsage(1, end, 604_800_000, start + 15 * 60_000), 7)
  assert.equal(projectDailyUsage(4, end, 604_800_000, start + 12 * 3_600_000), 28)
  assert.equal(projectDailyUsage(1, end, 604_800_000, start - 1), undefined)
  assert.equal(projectDailyUsage(1, end, 604_800_000, end), undefined)
})

test("linear projections are hidden for invalid or inactive windows", () => {
  assert.equal(projectDailyUsage(40, reset, 18_000_000, reset - 18_000_000), undefined)
  assert.equal(projectDailyUsage(40, reset, 18_000_000, reset - 18_000_001), undefined)
  assert.equal(projectDailyUsage(40, reset, 18_000_000, reset), undefined)
  assert.equal(projectDailyUsage(40, reset, 18_000_000, reset + 1), undefined)
  assert.equal(projectDailyUsage(40, NaN, 18_000_000, reset), undefined)
  assert.equal(projectDailyUsage(NaN, reset, 18_000_000, reset - 1), undefined)
  assert.equal(projectDailyUsage(40, reset, 0, reset - 1), undefined)
})
