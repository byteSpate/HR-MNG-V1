import { describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

import { composeWeek, type ComposeInput } from "./weekly.compose"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)
const at = (value: string) => new Date(value)

const SUNDAY = day("2026-09-13")
const MONDAY = day("2026-09-14")
const SATURDAY = day("2026-09-12")

const GENERAL = {
  id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  graceMinutes: 15, weeklyOffDays: [5], effectiveFrom: null, effectiveTo: null,
} as never

const accounts = [
  { id: "acc-1", name: "Bengal Group" },
  { id: "acc-2", name: "MIST" },
]

const input = (overrides: Partial<ComposeInput> = {}): ComposeInput => ({
  weekStart: SUNDAY,
  person: { shift: GENERAL, joiningDate: day("2020-01-01"), lastWorkingDay: null },
  holidays: [],
  leaves: [],
  accounts,
  communications: [],
  meetings: [],
  deals: [],
  dealChanges: [],
  tasksDone: [],
  openTasks: [],
  notes: [],
  otherWork: [],
  ...overrides,
})

const call = (overrides: Record<string, unknown> = {}) => ({
  id: "comm-1", salesAccountId: "acc-1", channel: "CALL",
  occurredAt: at("2026-09-14T05:00:00.000Z"), summary: "Asked about the firewall quote",
  ...overrides,
})

const meeting = (overrides: Record<string, unknown> = {}) => ({
  id: "meet-1", salesAccountId: "acc-1", title: "Firewall walkthrough",
  scheduledAt: at("2026-09-14T04:00:00.000Z"), status: "COMPLETED", outcome: "They want a revised price",
  ...overrides,
})

const deal = (overrides: Record<string, unknown> = {}) => ({
  id: "opp-1", salesAccountId: "acc-1", serial: "BS-OPP-00001", name: "Firewall Upgrade",
  status: "ONGOING", nextStep: "Send the revised quotation", softwareNeeded: null,
  lines: [{ product: "Cisco C9300", model: "C9300-24T-4X", quantity: 2 }],
  ...overrides,
})

const dayOf = (week: ReturnType<typeof composeWeek>, date: Date) =>
  week.days.find((d) => d.date.getTime() === date.getTime())

describe("composeWeek", () => {
  it("has Sunday to Thursday, and leaves out a Saturday with nothing on it", () => {
    const week = composeWeek(input())
    expect(week.days.map((d) => d.date)).toEqual([
      SUNDAY, MONDAY, day("2026-09-15"), day("2026-09-16"), day("2026-09-17"),
    ])
  })

  it("opens with the Saturday when something happened on it", () => {
    const week = composeWeek(input({ otherWork: [{ id: "ow-1", date: SATURDAY, text: "Office discussion" }] }))
    expect(week.days[0].date).toEqual(SATURDAY)
    expect(week.days[0].otherWork.map((w) => w.text)).toEqual(["Office discussion"])
  })

  it("puts an account on the day it was called, and reads the day in office time", () => {
    // 23:30 Dhaka on Monday is already Tuesday in UTC.
    const week = composeWeek(input({ communications: [call({ occurredAt: at("2026-09-14T17:30:00.000Z") })] }))
    expect(dayOf(week, MONDAY)?.accounts.map((a) => a.accountName)).toEqual(["Bengal Group"])
    expect(dayOf(week, day("2026-09-15"))?.accounts).toEqual([])
  })

  it("puts several calls to one account on one day into one row", () => {
    const week = composeWeek(
      input({
        communications: [
          call(),
          call({ id: "comm-2", summary: "Called again, no answer" }),
          call({ id: "comm-3", salesAccountId: "acc-2", channel: "EMAIL", summary: "Sent the GPU offer" }),
        ],
      })
    )
    const rows = dayOf(week, MONDAY)!.accounts
    expect(rows).toHaveLength(2)
    expect(rows[0].visited).toEqual([
      "Call: Asked about the firewall quote",
      "Call: Called again, no answer",
    ])
    expect(rows[1].visited).toEqual(["Email: Sent the GPU offer"])
  })

  it("shows a meeting with its real status, a cancelled one included", () => {
    const week = composeWeek(
      input({ meetings: [meeting(), meeting({ id: "meet-2", salesAccountId: "acc-2", title: "Site survey", status: "CANCELLED", outcome: null })] })
    )
    const rows = dayOf(week, MONDAY)!.accounts
    expect(rows[0].visited).toEqual(["Meeting: Firewall walkthrough (Completed) — They want a revised price"])
    expect(rows[1].visited).toEqual(["Meeting: Site survey (Cancelled)"])
  })

  it("puts an account on the day its deal changed, and on the day a task was finished", () => {
    const week = composeWeek(
      input({
        deals: [deal()],
        dealChanges: [{ opportunityId: "opp-1", salesAccountId: "acc-1", at: at("2026-09-15T05:00:00.000Z"), title: "Stage changed to OEM Pricing" }],
        tasksDone: [{ id: "task-1", salesAccountId: "acc-2", title: "Send the profile", completedAt: at("2026-09-16T05:00:00.000Z") }],
      })
    )
    expect(dayOf(week, day("2026-09-15"))?.accounts[0].visited).toEqual(["Deal: Stage changed to OEM Pricing"])
    expect(dayOf(week, day("2026-09-16"))?.accounts[0].visited).toEqual(["Task done: Send the profile"])
  })

  it("fills the deal columns: requirement from the products, and the deal's own next step", () => {
    const week = composeWeek(input({ communications: [call()], deals: [deal({ softwareNeeded: true })] }))
    const row = dayOf(week, MONDAY)!.accounts[0]
    expect(row.deals).toEqual([
      {
        id: "opp-1",
        serial: "BS-OPP-00001",
        name: "Firewall Upgrade",
        requirement: "Cisco C9300 C9300-24T-4X × 2",
        softwareNeeded: true,
        nextStep: "Send the revised quotation",
      },
    ])
    expect(row.nextStep).toBeNull()
  })

  it("says so when the account has no open deal, and then keeps the typed next step", () => {
    const week = composeWeek(
      input({
        communications: [call()],
        deals: [deal({ status: "WON" })],
        notes: [{ date: MONDAY, salesAccountId: "acc-1", challenges: "He was sick", gap: "No company profile to send", nextStep: "Meet the IT team", taskId: "task-9" }],
      })
    )
    const row = dayOf(week, MONDAY)!.accounts[0]
    expect(row.deals).toEqual([])
    expect(row.requirement).toBe("No open requirement")
    expect(row.challenges).toBe("He was sick")
    expect(row.gap).toBe("No company profile to send")
    expect(row.nextStep).toBe("Meet the IT team")
    expect(row.taskId).toBe("task-9")
  })

  it("lists the person's open tasks on the account as Pending Task", () => {
    const week = composeWeek(
      input({
        communications: [call()],
        openTasks: [
          { id: "task-2", salesAccountId: "acc-1", title: "Submit the quotation", dueOn: day("2026-09-20") },
          { id: "task-3", salesAccountId: "acc-2", title: "Call the ICT cell", dueOn: day("2026-09-21") },
        ],
      })
    )
    expect(dayOf(week, MONDAY)!.accounts[0].pendingTasks.map((t) => t.title)).toEqual(["Submit the quotation"])
  })

  it("puts a typed note on a day the Sales Hub knows nothing about", () => {
    const week = composeWeek(
      input({ notes: [{ date: MONDAY, salesAccountId: "acc-2", challenges: "Nobody picked up", gap: null, nextStep: null, taskId: null }] })
    )
    expect(dayOf(week, MONDAY)!.accounts.map((a) => a.accountName)).toEqual(["MIST"])
  })

  it("labels a holiday and leaves its day empty", () => {
    const week = composeWeek(
      input({ holidays: [{ date: day("2026-09-16"), name: "Eid-e-Milad", type: "GENERAL" }] })
    )
    expect(dayOf(week, day("2026-09-16"))?.label).toEqual({ kind: "HOLIDAY", text: "Eid-e-Milad" })
  })

  it("counts the week for the PDF's strip", () => {
    const week = composeWeek(
      input({
        communications: [call(), call({ id: "comm-2", salesAccountId: "acc-2" })],
        meetings: [meeting()],
        dealChanges: [{ opportunityId: "opp-1", salesAccountId: "acc-1", at: at("2026-09-15T05:00:00.000Z"), title: "Won" }],
        tasksDone: [{ id: "task-1", salesAccountId: "acc-1", title: "Send the profile", completedAt: at("2026-09-16T05:00:00.000Z") }],
      })
    )
    expect(week.counts).toEqual({ accounts: 2, communications: 2, meetings: 1, dealChanges: 1, tasksDone: 1 })
  })
})
