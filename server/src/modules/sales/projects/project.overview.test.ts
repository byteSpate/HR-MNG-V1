import { describe, expect, it } from "vitest"

import { daysLeftOf, lastUpdateOf, latestOf, QUIET_AFTER_DAYS, quietDaysOf } from "./project.overview"

const at = (iso: string) => new Date(iso)

describe("the newest time", () => {
  it("picks the latest, and ignores blanks", () => {
    expect(latestOf([at("2026-09-01T00:00:00Z"), null, undefined, at("2026-09-03T00:00:00Z"), at("2026-09-02T00:00:00Z")]))
      .toEqual(at("2026-09-03T00:00:00Z"))
  })

  it("is null when there is nothing", () => {
    expect(latestOf([])).toBeNull()
    expect(latestOf([null, undefined])).toBeNull()
  })
})

describe("when something last happened on a Project", () => {
  it("counts a log line, a task change, a milestone tick, a product tick and a change to the Project", () => {
    const base = { projectUpdatedAt: at("2026-09-01T00:00:00Z"), logs: [], tasks: [], milestonesDoneAt: [], lineTicks: [] }
    expect(lastUpdateOf(base)).toEqual(at("2026-09-01T00:00:00Z"))
    expect(lastUpdateOf({ ...base, logs: [at("2026-09-05T00:00:00Z")] })).toEqual(at("2026-09-05T00:00:00Z"))
    expect(lastUpdateOf({ ...base, tasks: [at("2026-09-06T00:00:00Z")] })).toEqual(at("2026-09-06T00:00:00Z"))
    expect(lastUpdateOf({ ...base, milestonesDoneAt: [null, at("2026-09-07T00:00:00Z")] })).toEqual(at("2026-09-07T00:00:00Z"))
    expect(lastUpdateOf({ ...base, lineTicks: [at("2026-09-08T00:00:00Z")] })).toEqual(at("2026-09-08T00:00:00Z"))
  })
})

describe("gone quiet", () => {
  const NOW = at("2026-09-28T10:00:00Z")

  it("starts at exactly 7 days of silence, and not a minute before (Review Focus 2)", () => {
    expect(QUIET_AFTER_DAYS).toBe(7)
    expect(quietDaysOf("IN_PROGRESS", at("2026-09-21T10:00:00Z"), NOW)).toBe(7)
    expect(quietDaysOf("IN_PROGRESS", at("2026-09-21T10:01:00Z"), NOW)).toBeNull()
    expect(quietDaysOf("IN_PROGRESS", at("2026-09-19T10:00:00Z"), NOW)).toBe(9)
  })

  it("only a Project in progress can go quiet", () => {
    for (const status of ["NOT_STARTED", "BLOCKED", "ON_HOLD", "COMPLETED", "CANCELLED"]) {
      expect(quietDaysOf(status, at("2026-08-01T00:00:00Z"), NOW)).toBeNull()
    }
  })
})

describe("days left", () => {
  const TODAY = at("2026-09-28T00:00:00Z")

  it("counts to the finish date, and goes negative once it has passed (Review Focus 3)", () => {
    expect(daysLeftOf(at("2026-10-05T00:00:00Z"), "IN_PROGRESS", TODAY)).toBe(7)
    expect(daysLeftOf(at("2026-09-28T00:00:00Z"), "IN_PROGRESS", TODAY)).toBe(0)
    expect(daysLeftOf(at("2026-09-25T00:00:00Z"), "IN_PROGRESS", TODAY)).toBe(-3)
  })

  it("is null with no finish date, and for a finished Project", () => {
    expect(daysLeftOf(null, "IN_PROGRESS", TODAY)).toBeNull()
    expect(daysLeftOf(at("2026-10-05T00:00:00Z"), "COMPLETED", TODAY)).toBeNull()
    expect(daysLeftOf(at("2026-10-05T00:00:00Z"), "CANCELLED", TODAY)).toBeNull()
  })
})
