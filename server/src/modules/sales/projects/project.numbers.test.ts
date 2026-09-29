import { describe, expect, it } from "vitest"
import { healthOf, peopleNumbers, progressOf } from "./project.numbers"

const day = (s: string) => new Date(`${s}T00:00:00.000Z`)
const TODAY = day("2026-10-01")

describe("project numbers", () => {
  it("counts progress over tasks that are not cancelled, and has none with no tasks", () => {
    expect(progressOf([{ status: "DONE" }, { status: "PENDING" }, { status: "CANCELLED" }])).toEqual({ done: 1, total: 2, percent: 50 })
    expect(progressOf([])).toBeNull()
    expect(progressOf([{ status: "CANCELLED" }])).toBeNull()
  })

  it("rounds a percent that does not come out whole, because a decimal percent is noise", () => {
    expect(progressOf([{ status: "DONE" }, { status: "PENDING" }, { status: "PENDING" }]))
      .toEqual({ done: 1, total: 3, percent: 33 })
    expect(progressOf([{ status: "DONE" }, { status: "DONE" }, { status: "PENDING" }]))
      .toEqual({ done: 2, total: 3, percent: 67 })
  })

  it("is 100% when every counted task is done", () => {
    expect(progressOf([{ status: "DONE" }, { status: "DONE" }])).toEqual({ done: 2, total: 2, percent: 100 })
  })

  it("is 0% when work has been given but none of it is done, and never no tasks", () => {
    expect(progressOf([{ status: "PENDING" }])).toEqual({ done: 0, total: 1, percent: 0 })
  })

  it("counts open and late tasks per person, including people with none", () => {
    const tasks = [
      { status: "PENDING", dueOn: day("2026-09-30"), assignedToEmployeeId: "a" },
      { status: "PENDING", dueOn: day("2026-10-05"), assignedToEmployeeId: "a" },
      { status: "DONE", dueOn: day("2026-09-01"), assignedToEmployeeId: "a" },
    ]
    expect(peopleNumbers(tasks, [{ employeeId: "a", fullName: "Karim" }, { employeeId: "b", fullName: "Nadia" }], TODAY)).toEqual([
      { employeeId: "a", fullName: "Karim", open: 2, late: 1 },
      { employeeId: "b", fullName: "Nadia", open: 0, late: 0 },
    ])
  })

  it("does not count a cancelled task as somebody's open work", () => {
    const tasks = [{ status: "CANCELLED", dueOn: day("2026-09-01"), assignedToEmployeeId: "a" }]
    expect(peopleNumbers(tasks, [{ employeeId: "a", fullName: "Karim" }], TODAY))
      .toEqual([{ employeeId: "a", fullName: "Karim", open: 0, late: 0 }])
  })

  it("does not count a done task as late, however long ago it was due", () => {
    const tasks = [{ status: "DONE", dueOn: day("2026-01-01"), assignedToEmployeeId: "a" }]
    expect(peopleNumbers(tasks, [{ employeeId: "a", fullName: "Karim" }], TODAY))
      .toEqual([{ employeeId: "a", fullName: "Karim", open: 0, late: 0 }])
  })

  it("keeps the order it was given, so the table does not jump about", () => {
    const people = [{ employeeId: "b", fullName: "Nadia" }, { employeeId: "a", fullName: "Karim" }]
    expect(peopleNumbers([], people, TODAY).map((p) => p.fullName)).toEqual(["Nadia", "Karim"])
  })

  it("is Late for an overdue task or a passed finish date", () => {
    expect(healthOf({ status: "IN_PROGRESS", dueOn: null }, [{ status: "PENDING", dueOn: day("2026-09-30") }], TODAY)).toBe("LATE")
    expect(healthOf({ status: "IN_PROGRESS", dueOn: day("2026-09-20") }, [], TODAY)).toBe("LATE")
  })

  it("is At risk when a task is due within 3 days", () => {
    expect(healthOf({ status: "IN_PROGRESS", dueOn: null }, [{ status: "PENDING", dueOn: day("2026-10-04") }], TODAY)).toBe("AT_RISK")
    expect(healthOf({ status: "IN_PROGRESS", dueOn: null }, [{ status: "PENDING", dueOn: day("2026-10-05") }], TODAY)).toBe("ON_TRACK")
  })

  it("treats a task due today as at risk, not late: today is not yet missed", () => {
    expect(healthOf({ status: "IN_PROGRESS", dueOn: null }, [{ status: "PENDING", dueOn: TODAY }], TODAY)).toBe("AT_RISK")
  })

  it("does not count the finish date towards At risk: that rule is about tasks (spec §2.3)", () => {
    // Late knows about the finish date; At risk is defined by tasks only.
    expect(healthOf({ status: "IN_PROGRESS", dueOn: day("2026-10-03") }, [], TODAY)).toBe("ON_TRACK")
  })

  it("does not call a done task late or at risk", () => {
    expect(healthOf({ status: "IN_PROGRESS", dueOn: null }, [{ status: "DONE", dueOn: day("2026-01-01") }], TODAY)).toBe("ON_TRACK")
  })

  it("does not call a cancelled task late or at risk", () => {
    expect(healthOf({ status: "IN_PROGRESS", dueOn: null }, [{ status: "CANCELLED", dueOn: day("2026-01-01") }], TODAY)).toBe("ON_TRACK")
  })

  it("is On track when there is simply nothing pending and nothing passed", () => {
    expect(healthOf({ status: "IN_PROGRESS", dueOn: null }, [], TODAY)).toBe("ON_TRACK")
  })

  it("prefers Late over At risk when both are true", () => {
    expect(healthOf(
      { status: "IN_PROGRESS", dueOn: day("2026-09-01") },
      [{ status: "PENDING", dueOn: day("2026-10-02") }],
      TODAY,
    )).toBe("LATE")
  })

  it("has no health once Completed or Cancelled", () => {
    expect(healthOf({ status: "COMPLETED", dueOn: day("2026-09-01") }, [], TODAY)).toBeNull()
    expect(healthOf({ status: "CANCELLED", dueOn: null }, [], TODAY)).toBeNull()
  })

  it("has no health while Not Started, because nothing is late before the work begins", () => {
    expect(healthOf({ status: "NOT_STARTED", dueOn: day("2026-09-01") }, [], TODAY)).toBeNull()
  })

  it("still says something for a Not Started Project that has been given work", () => {
    // A task that is already overdue means the Project is behind even though
    // nobody has pressed Start yet.
    expect(healthOf({ status: "NOT_STARTED", dueOn: null }, [{ status: "PENDING", dueOn: day("2026-09-01") }], TODAY))
      .toBe("LATE")
  })
})
