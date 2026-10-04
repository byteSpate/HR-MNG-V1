import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../config/prisma", () => ({
  default: {
    user: { findMany: vi.fn() },
    emailDispatch: { findMany: vi.fn() },
  },
}))
vi.mock("../modules/attendance/attendance.report", () => ({
  getAttendanceReport: vi.fn(),
  reportToCsv: vi.fn(() => "csv,data"),
  reportFilename: vi.fn((r: { from: string; to: string }, ext: string) => `attendance-${r.from}-to-${r.to}.${ext}`),
}))
vi.mock("../modules/attendance/attendance.report.pdf", () => ({
  renderAttendanceReportPdf: vi.fn(),
}))
vi.mock("../modules/attendance/attendance.mailer", () => ({
  sendApprovalsDigest: vi.fn(),
  sendMissingCheckOutNudge: vi.fn(),
  sendAttendanceReportEmail: vi.fn(),
}))

import prisma from "../config/prisma"
import { sendAttendanceReportEmail } from "../modules/attendance/attendance.mailer"
import { getAttendanceReport } from "../modules/attendance/attendance.report"
import { renderAttendanceReportPdf } from "../modules/attendance/attendance.report.pdf"
import {
  runDailyAttendanceReportEmail,
  runMonthlyAttendanceReportEmail,
} from "./attendance-report-email.job"

/** 00:10 on Sunday 4 Oct 2026 in Dhaka is 18:10 on the 3rd in UTC. */
const DAILY_NOW = new Date("2026-10-03T18:10:00.000Z")
/** 08:00 on Thursday 1 Oct 2026 in Dhaka is 02:00 UTC the same day. */
const MONTHLY_NOW = new Date("2026-10-01T02:00:00.000Z")

const report = (from: string, to: string, workingDays = 20) => ({
  from,
  to,
  granularity: "summary" as const,
  headcount: 12,
  rows: [],
  days: [],
  totals: {
    workingDays, present: 10, absent: 1, onLeave: 1, notCheckedIn: 0, late: 2, earlyOut: 0,
    workedHours: 80, expectedHours: 96, shortfallHours: 16, missingCheckOut: 1, pendingApproval: 3,
  },
})

const admins = [
  { id: "u1", email: "one@demo.com" },
  { id: "u2", email: "two@demo.com" },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.findMany).mockResolvedValue(admins as never)
  vi.mocked(prisma.emailDispatch.findMany).mockResolvedValue([] as never)
  vi.mocked(getAttendanceReport).mockImplementation((async (_actor: unknown, input: { from: string; to: string }) =>
    report(input.from, input.to)) as never)
  vi.mocked(renderAttendanceReportPdf).mockResolvedValue(Buffer.from("pdf"))
})

describe("the daily attendance report email", () => {
  it("reports yesterday in office time, as a super admin would see it", async () => {
    await runDailyAttendanceReportEmail(DAILY_NOW)

    expect(getAttendanceReport).toHaveBeenCalledTimes(1)
    const [actor, input] = vi.mocked(getAttendanceReport).mock.calls[0]
    expect(actor).toMatchObject({ role: "SUPER_ADMIN" })
    expect(input).toEqual({ from: "2026-10-03", to: "2026-10-03", granularity: "daily" })
  })

  it("goes to every active super admin and nobody else", async () => {
    await runDailyAttendanceReportEmail(DAILY_NOW)

    expect(vi.mocked(prisma.user.findMany).mock.calls[0][0]).toMatchObject({
      where: { role: "SUPER_ADMIN", isActive: true },
    })
  })

  it("builds the report once and sends one email each, with a PDF and a CSV", async () => {
    const sent = await runDailyAttendanceReportEmail(DAILY_NOW)

    expect(sent).toBe(2)
    expect(getAttendanceReport).toHaveBeenCalledTimes(1)
    expect(renderAttendanceReportPdf).toHaveBeenCalledTimes(1)
    expect(sendAttendanceReportEmail).toHaveBeenCalledTimes(2)
    expect(sendAttendanceReportEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "one@demo.com",
        frequency: "daily",
        periodKey: "2026-10-03",
        link: expect.stringContaining("/admin/attendance"),
        attachments: [
          expect.objectContaining({ filename: "attendance-2026-10-03-to-2026-10-03.pdf" }),
          expect.objectContaining({ filename: "attendance-2026-10-03-to-2026-10-03.csv" }),
        ],
      })
    )
  })

  it("skips anybody who already has the email for that day, and retries a failed send", async () => {
    await runDailyAttendanceReportEmail(DAILY_NOW)
    expect(vi.mocked(prisma.emailDispatch.findMany).mock.calls[0][0]).toMatchObject({
      where: { kind: "ATTENDANCE_REPORT_DAILY", entityId: "2026-10-03", error: null },
    })

    vi.clearAllMocks()
    vi.mocked(prisma.user.findMany).mockResolvedValue(admins as never)
    vi.mocked(prisma.emailDispatch.findMany).mockResolvedValue([{ to: "one@demo.com" }] as never)
    vi.mocked(getAttendanceReport).mockResolvedValue(report("2026-10-03", "2026-10-03") as never)
    vi.mocked(renderAttendanceReportPdf).mockResolvedValue(Buffer.from("pdf"))

    const sent = await runDailyAttendanceReportEmail(DAILY_NOW)

    expect(sent).toBe(1)
    expect(sendAttendanceReportEmail).toHaveBeenCalledTimes(1)
    expect(sendAttendanceReportEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "two@demo.com" }))
  })

  it("does no work when everybody already has it", async () => {
    vi.mocked(prisma.emailDispatch.findMany).mockResolvedValue([
      { to: "one@demo.com" },
      { to: "two@demo.com" },
    ] as never)

    expect(await runDailyAttendanceReportEmail(DAILY_NOW)).toBe(0)
    expect(getAttendanceReport).not.toHaveBeenCalled()
    expect(renderAttendanceReportPdf).not.toHaveBeenCalled()
  })

  it("does nothing when there is no super admin", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)

    expect(await runDailyAttendanceReportEmail(DAILY_NOW)).toBe(0)
    expect(getAttendanceReport).not.toHaveBeenCalled()
  })

  it("sends nothing for a day nobody was expected to work", async () => {
    vi.mocked(getAttendanceReport).mockResolvedValue(report("2026-10-03", "2026-10-03", 0) as never)

    expect(await runDailyAttendanceReportEmail(DAILY_NOW)).toBe(0)
    expect(renderAttendanceReportPdf).not.toHaveBeenCalled()
    expect(sendAttendanceReportEmail).not.toHaveBeenCalled()
  })

  it("still sends the CSV when the PDF cannot be made", async () => {
    vi.mocked(renderAttendanceReportPdf).mockRejectedValue(new Error("no chrome"))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(await runDailyAttendanceReportEmail(DAILY_NOW)).toBe(2)

    const call = vi.mocked(sendAttendanceReportEmail).mock.calls[0][0]
    expect(call.attachments).toEqual([expect.objectContaining({ filename: expect.stringMatching(/\.csv$/) })])
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe("the monthly attendance report email", () => {
  it("reports the whole month that just ended, one row per person", async () => {
    await runMonthlyAttendanceReportEmail(MONTHLY_NOW)

    const [actor, input] = vi.mocked(getAttendanceReport).mock.calls[0]
    expect(actor).toMatchObject({ role: "SUPER_ADMIN" })
    expect(input).toEqual({ from: "2026-09-01", to: "2026-09-30", granularity: "summary" })
  })

  it("keys the email by month, so a second run in the same month sends nothing new", async () => {
    await runMonthlyAttendanceReportEmail(MONTHLY_NOW)

    expect(vi.mocked(prisma.emailDispatch.findMany).mock.calls[0][0]).toMatchObject({
      where: { kind: "ATTENDANCE_REPORT_MONTHLY", entityId: "2026-09", error: null },
    })
    expect(sendAttendanceReportEmail).toHaveBeenCalledWith(
      expect.objectContaining({ frequency: "monthly", periodKey: "2026-09" })
    )
  })

  it("rolls back into December of the year before in January", async () => {
    await runMonthlyAttendanceReportEmail(new Date("2027-01-01T02:00:00.000Z"))

    expect(vi.mocked(getAttendanceReport).mock.calls[0][1]).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
      granularity: "summary",
    })
  })

  it("sends nothing for a month with no tracked working days", async () => {
    vi.mocked(getAttendanceReport).mockResolvedValue(report("2026-09-01", "2026-09-30", 0) as never)

    expect(await runMonthlyAttendanceReportEmail(MONTHLY_NOW)).toBe(0)
    expect(sendAttendanceReportEmail).not.toHaveBeenCalled()
  })
})
