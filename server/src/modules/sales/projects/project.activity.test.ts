import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    project: { findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
}))
vi.mock("../../dealMoney/dealMoney.cost", () => ({ dealCostLineWhere: vi.fn().mockResolvedValue({}) }))

import prisma from "../../../config/prisma"
import { listProjectActivity } from "./project.activity"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const NOW = new Date("2026-09-28T10:00:00.000Z")
const LATER = new Date("2026-09-29T10:00:00.000Z")

const projectRow = {
  id: "prj-1", serial: "BS-PRJ-00001", name: "Core refresh", status: "IN_PROGRESS",
  managerEmployeeId: "emp-1", team: [], milestones: [],
}

const MILESTONE_ROW = {
  id: "a2", action: "UPDATE", changedBy: "user-1", changedAt: LATER,
  before: { milestone: "Design", done: false }, after: { done: true }, note: "Milestone reached",
}
const STATUS_ROW = {
  id: "a1", action: "UPDATE", changedBy: "user-1", changedAt: NOW,
  before: { status: "NOT_STARTED" }, after: { status: "IN_PROGRESS" }, note: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.project.findFirst).mockResolvedValue(projectRow as any)
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([MILESTONE_ROW, STATUS_ROW] as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "user-1", displayName: "rahim", email: "rahim@example.com", employee: { fullName: "Rahim" } },
  ] as any)
})

describe("Project activity", () => {
  it("reads the newest first and names what happened in plain words", async () => {
    expect(await listProjectActivity("prj-1", USER)).toEqual([
      expect.objectContaining({ id: "a2", text: "Milestone reached: Design", byName: "Rahim" }),
      expect.objectContaining({ id: "a1", text: "Status: Not started to In progress", byName: "Rahim" }),
    ])
  })

  it("reads only this Project's own audit rows, and asks for no more than fifty", async () => {
    await listProjectActivity("prj-1", USER)
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { entity: "PROJECT", entityId: "prj-1" },
      orderBy: { changedAt: "desc" },
      take: 50,
    }))
  })

  it("calls the Project's start a start", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: "a3", action: "CREATE", changedBy: "user-1", changedAt: LATER, before: null, after: { serial: "BS-PRJ-00001" }, note: null },
    ] as any)
    expect(await listProjectActivity("prj-1", USER)).toEqual([
      expect.objectContaining({ id: "a3", text: "Project started" }),
    ])
  })

  it("falls back to the note when a row says nothing this screen can name", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: "a4", action: "UPDATE", changedBy: "user-1", changedAt: LATER, before: null, after: null, note: "Team changed" },
    ] as any)
    expect(await listProjectActivity("prj-1", USER)).toEqual([
      expect.objectContaining({ id: "a4", text: "Team changed" }),
    ])
  })

  it("says Project changed when a row has no note and nothing else to say", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: "a5", action: "UPDATE", changedBy: "user-1", changedAt: LATER, before: null, after: null, note: null },
    ] as any)
    expect(await listProjectActivity("prj-1", USER)).toEqual([
      expect.objectContaining({ id: "a5", text: "Project changed" }),
    ])
  })

  it("names a milestone from the before side, because that is the one that has the title", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      {
        id: "a6", action: "UPDATE", changedBy: "user-1", changedAt: LATER,
        before: { milestone: "Deployment" }, after: { done: true }, note: null,
      },
    ] as any)
    expect(await listProjectActivity("prj-1", USER)).toEqual([
      expect.objectContaining({ id: "a6", text: "Milestone changed: Deployment" }),
    ])
  })

  it("leaves the name blank when the row has nobody to blame, rather than guessing", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: "a7", action: "CREATE", changedBy: null, changedAt: LATER, before: null, after: {}, note: null },
    ] as any)
    expect(await listProjectActivity("prj-1", USER)).toEqual([
      expect.objectContaining({ id: "a7", byName: null }),
    ])
    // Nobody to look up, so no directory query at all.
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })

  it("falls back to the display name, then the email, when there is no employee", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "user-1", displayName: "rahim", email: "rahim@example.com", employee: null },
    ] as any)
    expect(await listProjectActivity("prj-1", USER)).toEqual([
      expect.objectContaining({ byName: "rahim" }), expect.objectContaining({ byName: "rahim" }),
    ])
  })

  it("leaves the name blank when the person is no longer in the directory", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
    const rows = await listProjectActivity("prj-1", USER)
    expect(rows.every((r) => r.byName === null)).toBe(true)
  })

  it("asks for each person once, however many rows they wrote", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([MILESTONE_ROW, STATUS_ROW, MILESTONE_ROW] as any)
    await listProjectActivity("prj-1", USER)
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["user-1"] } },
    }))
  })

  it("refuses a Project the caller cannot see", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null as any)
    await expect(listProjectActivity("prj-1", USER)).rejects.toThrow("That Project does not exist, or is not yours")
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled()
  })
})
