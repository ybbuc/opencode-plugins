import assert from "node:assert/strict"
import test from "node:test"
import { project, projectLinear } from "./pace.ts"

const reset = new Date(2026, 1, 1).getTime()
const at = (month: number, day: number) => new Date(2026, month, day, 12).getTime()

test("weekday holidays do not count toward the pace", () => {
  // January 2026 has 22 weekdays, New Year's Day among them; 11 of the rest have passed by the 16th.
  assert.equal(project(66, reset, at(0, 16)), 126)
})

test("a weekend does not move the projection", () => {
  assert.equal(project(66, reset, at(0, 18)), 126)
  assert.equal(Math.round(project(66, reset, at(0, 19))!), 116)
})

test("a holiday at the window start leaves nothing elapsed", () => {
  assert.equal(project(10, new Date(2026, 5, 1).getTime(), at(4, 1)), undefined)
})

test("movable holidays count, Corpus Christi included", () => {
  const july = new Date(2026, 6, 1).getTime()
  // June 2026 has 22 weekdays and Corpus Christi; three workdays have passed by Thursday the 4th.
  assert.equal(project(7, july, at(5, 4)), 49)
})

test("no projection without a window", () => {
  assert.equal(project(60, Number.NaN, at(0, 16)), undefined)
  assert.equal(project(60, reset, new Date(2026, 0, 1).getTime()), undefined)
  assert.equal(project(60, reset, reset), undefined)
})

test("linear projections use elapsed time even on weekends and holidays", () => {
  const sessionReset = new Date(2026, 0, 1, 15).getTime()
  const weeklyReset = new Date(2026, 0, 7, 0).getTime()
  assert.equal(projectLinear(60, sessionReset, 18_000_000, new Date(2026, 0, 1, 12, 30).getTime()), 120)
  assert.equal(projectLinear(40, weeklyReset, 604_800_000, new Date(2026, 0, 3, 12).getTime()), 80)
  assert.equal(projectLinear(0, sessionReset, 18_000_000, sessionReset - 1), 0)
})

test("linear projections are hidden for invalid or inactive windows", () => {
  assert.equal(projectLinear(40, reset, 18_000_000, reset - 18_000_000), undefined)
  assert.equal(projectLinear(40, reset, 18_000_000, reset - 18_000_001), undefined)
  assert.equal(projectLinear(40, reset, 18_000_000, reset), undefined)
  assert.equal(projectLinear(40, reset, 18_000_000, reset + 1), undefined)
  assert.equal(projectLinear(40, NaN, 18_000_000, reset), undefined)
  assert.equal(projectLinear(NaN, reset, 18_000_000, reset - 1), undefined)
  assert.equal(projectLinear(40, reset, 0, reset - 1), undefined)
})
