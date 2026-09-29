import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    projectTeamMember: { findFirst: vi.fn() },
    weeklyReport: { upsert: vi.fn(), update: vi.fn() },
    projectDailyLog: { upsert: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../../config/prisma"
import { removeProjectLog, saveProjectLog } from "./weekly.dailylog"
import { saveProjectLogSchema } from "./weekly.validators"

const WRITER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const PROJECT = "22222222-2222-4222-8222-222222222222"
/** Tuesday 29 September 2026, inside the week that opened on Sunday the 27th. */
const TUESDAY = "2026-09-29"

beforeEach(() => {
  vi.clearAllMocks()
  // A Thursday in Dhaka, so Tuesday has already happened and Friday has not.
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-01T06:00:00.000Z"))
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
  vi.mocked(prisma.projectTeamMember.findFirst).mockResolvedValue({ id: "tm1" } as any)
  vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue({ id: "wr-1", status: "DRAFT" } as any)
  vi.mocked(prisma.projectDailyLog.findFirst).mockResolvedValue({ id: "log-9", weeklyReportId: "wr-1", projectId: PROJECT, text: "Set up VPN" } as any)
  vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("a Daily Log line", () => {
  it("needs text unless No work is ticked", () => {
    expect(saveProjectLogSchema.safeParse({ date: TUESDAY, projectId: PROJECT, noWork: false, text: "" }).success).toBe(false)
    expect(saveProjectLogSchema.safeParse({ date: TUESDAY, projectId: PROJECT, noWork: true, text: null }).success).toBe(true)
  })

  it("needs text that is not only spaces", () => {
    expect(saveProjectLogSchema.safeParse({ date: TUESDAY, projectId: PROJECT, noWork: false, text: "   " }).success).toBe(false)
  })

  it("saves a line for a Project the person is on", async () => {
    await saveProjectLog({ date: TUESDAY, projectId: PROJECT, noWork: false, text: "Set up VPN" }, WRITER)
    expect(prisma.projectDailyLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        weeklyReportId: "wr-1", projectId: PROJECT,
        date: new Date("2026-09-29T00:00:00.000Z"), noWork: false, text: "Set up VPN",
      }),
    }))
  })

  it("stores no text at all when No work is ticked, rather than an empty string", async () => {
    await saveProjectLog({ date: TUESDAY, projectId: PROJECT, noWork: true, text: null }, WRITER)
    const create = vi.mocked(prisma.projectDailyLog.upsert).mock.calls[0][0].create as any
    expect(create.noWork).toBe(true)
    expect(create.text).toBeNull()
  })

  it("keeps the text it already had when No work is ticked, from the body", async () => {
    // The form may still hold a half-typed line; No work wins and the stored
    // text is empty, so the two never disagree.
    await saveProjectLog({ date: TUESDAY, projectId: PROJECT, noWork: true, text: "half typed" }, WRITER)
    const create = vi.mocked(prisma.projectDailyLog.upsert).mock.calls[0][0].create as any
    expect(create.text).toBeNull()
  })

  it("trims the text it saves, so the line reads the same everywhere", async () => {
    await saveProjectLog({ date: TUESDAY, projectId: PROJECT, noWork: false, text: "  Set up VPN  " }, WRITER)
    const create = vi.mocked(prisma.projectDailyLog.upsert).mock.calls[0][0].create as any
    expect(create.text).toBe("Set up VPN")
  })

  it("overwrites the same day's line rather than adding a second one", async () => {
    await saveProjectLog({ date: TUESDAY, projectId: PROJECT, noWork: false, text: "Set up VPN" }, WRITER)
    expect(prisma.projectDailyLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { weeklyReportId_projectId_date: { weeklyReportId: "wr-1", projectId: PROJECT, date: new Date("2026-09-29T00:00:00.000Z") } },
    }))
  })

  it("refuses a Project the person is not on (Review Focus 4)", async () => {
    vi.mocked(prisma.projectTeamMember.findFirst).mockResolvedValue(null as any)
    await expect(saveProjectLog({ date: TUESDAY, projectId: PROJECT, noWork: true, text: null }, WRITER))
      .rejects.toThrow("That Project does not exist, or you are not on its team")
    expect(prisma.projectDailyLog.upsert).not.toHaveBeenCalled()
  })

  it("refuses a day still to come (Review Focus 4)", async () => {
    await expect(saveProjectLog({ date: "2026-10-04", projectId: PROJECT, noWork: true, text: null }, WRITER))
      .rejects.toThrow(/has not happened yet|not in this week|not happened yet/)
  })

  it("refuses a day that is not a date at all", async () => {
    await expect(saveProjectLog({ date: "yesterday", projectId: PROJECT, noWork: true, text: null } as any, WRITER))
      .rejects.toThrow("yesterday is not a date on the calendar")
  })

  it("reopens a submitted week, the same as Other work does", async () => {
    vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue({ id: "wr-1", status: "SUBMITTED" } as any)
    await saveProjectLog({ date: TUESDAY, projectId: PROJECT, noWork: true, text: null }, WRITER)
    expect(prisma.weeklyReport.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "DRAFT" } }),
    )
  })

  it("audits the line, so the week's history says what was written", async () => {
    await saveProjectLog({ date: TUESDAY, projectId: PROJECT, noWork: false, text: "Set up VPN" }, WRITER)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "WEEKLY_REPORT", note: "Daily Log written" }),
    }))
  })

  it("refuses a caller who does not write Weekly Reports", async () => {
    await expect(saveProjectLog(
      { date: TUESDAY, projectId: PROJECT, noWork: true, text: null },
      { ...WRITER, salesRole: "SALES_ADMIN" },
    )).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("removing a Daily Log line", () => {
  it("removes the person's own line", async () => {
    await removeProjectLog("log-9", WRITER)
    expect(prisma.projectDailyLog.delete).toHaveBeenCalledWith({ where: { id: "log-9" } })
  })

  it("audits the removal, with the line that went", async () => {
    await removeProjectLog("log-9", WRITER)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ before: { projectId: PROJECT, text: "Set up VPN" }, note: "Daily Log removed" }),
    }))
  })

  it("lets a person remove only their own line", async () => {
    vi.mocked(prisma.projectDailyLog.findFirst).mockResolvedValue(null as any)
    await expect(removeProjectLog("log-9", WRITER)).rejects.toThrow("That line does not exist, or is not yours")
    expect(prisma.projectDailyLog.delete).not.toHaveBeenCalled()
  })
})
