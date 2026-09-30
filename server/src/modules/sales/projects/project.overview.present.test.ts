import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Prisma } from "../../../generated/prisma/client"
import { presentProject } from "./project.present"

const NOW = new Date("2026-09-28T10:00:00.000Z")
const d = (v: string) => new Prisma.Decimal(v)
const ADMIN = { sub: "user-9", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const ctx = (o: Record<string, unknown> = {}) =>
  ({ actor: ADMIN, employeeId: null, spentSoFar: null, canSeeCost: false, tickNames: new Map<string, string>(), ...o }) as any

const line = (o: Record<string, unknown> = {}) => ({
  id: "l1", product: "Firewall", oemBrand: null, model: null, partNo: null, quantity: 1, note: null,
  supplier: null, lineValue: null, marginPercent: null, order: 0, projectTicks: [], ...o,
})
const row = (o: Record<string, unknown> = {}) => ({
  id: "prj-1", serial: "BS-PRJ-00001", name: "Core refresh", opportunityId: "opp-1", salesAccountId: "acc-1",
  managerEmployeeId: "emp-1", startOn: null, dueOn: new Date("2026-10-05T00:00:00.000Z"), priority: "NORMAL",
  budget: null, status: "IN_PROGRESS", statusReason: null, completedAt: null,
  createdAt: NOW, updatedAt: new Date("2026-09-27T10:00:00.000Z"),
  manager: { id: "emp-1", fullName: "Rahim" },
  salesAccount: { id: "acc-1", name: "Rising Group", ownerEmployeeId: "emp-1", assignments: [] },
  opportunity: { id: "opp-1", serial: "BS-OPP-00001", name: "Core refresh", track: "NETWORKING", amount: d("100000"), lines: [line()] },
  team: [], milestones: [], tasks: [], dailyLogs: [], ...o,
}) as any

beforeEach(() => vi.setSystemTime(NOW))
afterEach(() => vi.useRealTimers())

describe("what a Project says about its own situation", () => {
  it("gives the days left, and the time of the last update", () => {
    const p = presentProject(row(), ctx())
    expect(p.daysLeft).toBe(7)
    expect(p.lastUpdateAt).toBe("2026-09-27T10:00:00.000Z")
    expect(p.quietDays).toBeNull()
    expect(p.latestLog).toBeNull()
  })

  it("shows the Daily Log line written most recently, with who wrote it", () => {
    const p = presentProject(row({
      dailyLogs: [{
        date: new Date("2026-09-26T00:00:00.000Z"), text: "Racked the switches", noWork: false,
        updatedAt: new Date("2026-09-26T12:00:00.000Z"), weeklyReport: { employee: { fullName: "Karim" } },
      }],
    }), ctx())
    expect(p.latestLog).toEqual({ date: "2026-09-26", byName: "Karim", text: "Racked the switches", noWork: false })
  })

  it("says a day with no work was a day with no work", () => {
    const p = presentProject(row({
      dailyLogs: [{
        date: new Date("2026-09-26T00:00:00.000Z"), text: null, noWork: true,
        updatedAt: new Date("2026-09-26T12:00:00.000Z"), weeklyReport: { employee: { fullName: "Karim" } },
      }],
    }), ctx())
    expect(p.latestLog).toMatchObject({ text: null, noWork: true })
  })

  it("has gone quiet after 7 days, unless a product was ticked on this Project since (Review Focus 2)", () => {
    const quiet = { updatedAt: new Date("2026-09-19T10:00:00.000Z") }
    expect(presentProject(row(quiet), ctx()).quietDays).toBe(9)

    const ticked = (projectId: string) =>
      row({ ...quiet, opportunity: { ...row().opportunity, lines: [line({ projectTicks: [{ projectId, doneAt: new Date("2026-09-27T10:00:00.000Z"), doneBy: "user-1" }] })] } })
    expect(presentProject(ticked("prj-1"), ctx()).quietDays).toBeNull()
    // A tick on a different Project is not an update here.
    expect(presentProject(ticked("prj-2"), ctx()).quietDays).toBe(9)
  })

  it("does not mark a Blocked Project quiet, and gives a finished one no days left", () => {
    const silent = { updatedAt: new Date("2026-09-01T10:00:00.000Z") }
    expect(presentProject(row({ ...silent, status: "BLOCKED" }), ctx()).quietDays).toBeNull()
    expect(presentProject(row({ status: "COMPLETED" }), ctx()).daysLeft).toBeNull()
  })

  it("never sends the spend to someone who may not see it (Review Focus 4)", () => {
    expect(presentProject(row(), ctx({ canSeeCost: false, spentSoFar: "1234.00" })).spentSoFar).toBeNull()
    expect(presentProject(row(), ctx({ canSeeCost: true, spentSoFar: "1234.00" })).spentSoFar).toBe("1234.00")
  })
})
