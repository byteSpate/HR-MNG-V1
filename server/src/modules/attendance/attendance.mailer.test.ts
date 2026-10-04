import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../utils/mailer", () => ({ notify: vi.fn() }))

import { notify } from "../../utils/mailer"
import { sendAttendanceReportEmail } from "./attendance.mailer"
import type { AttendanceReport } from "./attendance.report"

const report = (from: string, to: string): AttendanceReport => ({
  from,
  to,
  granularity: "summary",
  headcount: 12,
  rows: [],
  days: [],
  totals: {
    workingDays: 20, present: 10, absent: 1, onLeave: 1, notCheckedIn: 0, late: 2, earlyOut: 0,
    workedHours: 80, expectedHours: 96, shortfallHours: 16, missingCheckOut: 1, pendingApproval: 3,
  },
})

const pdf = { filename: "a.pdf", content: Buffer.from("pdf") }
const csv = { filename: "a.csv", content: Buffer.from("csv") }

const sent = () => vi.mocked(notify).mock.calls[0][0]

beforeEach(() => vi.clearAllMocks())

describe("sendAttendanceReportEmail", () => {
  it("sends the daily report with the day in the subject and the period as its key", async () => {
    await sendAttendanceReportEmail({
      to: "boss@demo.com", frequency: "daily", periodKey: "2026-10-03",
      report: report("2026-10-03", "2026-10-03"), link: "https://app.test/admin/attendance",
      attachments: [pdf, csv],
    })

    expect(sent()).toMatchObject({
      to: "boss@demo.com",
      kind: "ATTENDANCE_REPORT_DAILY",
      subject: "Attendance report for 3 October 2026",
      entity: "ATTENDANCE_REPORT",
      entityId: "2026-10-03",
      attachments: [pdf, csv],
    })
    expect(sent().html).toContain("PC-AD-20261003")
  })

  it("sends the monthly report with the month in the subject", async () => {
    await sendAttendanceReportEmail({
      to: "boss@demo.com", frequency: "monthly", periodKey: "2026-09",
      report: report("2026-09-01", "2026-09-30"), link: "https://app.test/admin/attendance",
      attachments: [pdf, csv],
    })

    expect(sent()).toMatchObject({
      kind: "ATTENDANCE_REPORT_MONTHLY",
      subject: "Attendance report for September 2026",
      entityId: "2026-09",
    })
    expect(sent().text).toContain("Days present: 10")
    expect(sent().text).toContain("on the 1st of each month at 8:00 am")
  })

  it("shows the totals in both the text and the html", async () => {
    await sendAttendanceReportEmail({
      to: "boss@demo.com", frequency: "daily", periodKey: "2026-10-03",
      report: report("2026-10-03", "2026-10-03"), link: "https://app.test/admin/attendance",
      attachments: [pdf, csv],
    })

    for (const line of ["People counted: 12", "Present: 10", "Absent: 1", "Late arrivals: 2", "No check-out: 1", "Waiting for approval: 3"]) {
      expect(sent().text).toContain(line)
    }
    expect(sent().html).toContain("Waiting for approval")
    expect(sent().html).toContain("https://app.test/admin/attendance")
  })

  it("says only a CSV is attached when there is no PDF", async () => {
    await sendAttendanceReportEmail({
      to: "boss@demo.com", frequency: "daily", periodKey: "2026-10-03",
      report: report("2026-10-03", "2026-10-03"), link: "https://app.test/admin/attendance",
      attachments: [csv],
    })

    expect(sent().text).toContain("attached as a CSV file")
    expect(sent().text).not.toContain("PDF")
  })
})
