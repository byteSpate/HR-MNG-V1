import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({
  env: { APP_TIMEZONE: "Asia/Dhaka", COMPANY_NAME: "Bytespate Limited" },
}))

vi.mock("../../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    shift: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
    salesAccount: { findMany: vi.fn() },
    salesCommunication: { findMany: vi.fn() },
    salesMeeting: { findMany: vi.fn() },
    opportunity: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    salesTask: { findMany: vi.fn() },
    weeklyReport: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    weeklyReportCopy: { create: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock("../../media/media.provider", () => ({ assertMediaConfigured: vi.fn() }))
vi.mock("../../media/media.service", () => ({
  uploadBuffer: vi.fn(),
  destroyAsset: vi.fn(),
  signedDocumentUrl: vi.fn(() => ({ url: "https://files.test/weekly.pdf" })),
}))
vi.mock("./weekly.pdf", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./weekly.pdf")>()),
  renderWeeklyPdf: vi.fn(async () => Buffer.from("%PDF-1.7 weekly")),
}))

import prisma from "../../../config/prisma"
import { assertMediaConfigured } from "../../media/media.provider"
import { destroyAsset, uploadBuffer } from "../../media/media.service"
import { renderWeeklyPdf } from "./weekly.pdf"
import { getWeeklyCopy, previewMyWeek, submitMyWeek } from "./weekly.submit"

const day = (value: string) => new Date(`${value}T00:00:00.000Z`)
const SUNDAY = day("2026-09-13")

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "rahim@demo.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as never
const ADMIN = {
  sub: "user-2", role: "EMPLOYEE", email: "admin@demo.com",
  mustChangePassword: false, salesRole: "SALES_ADMIN",
} as never

const GENERAL = {
  id: "shift-1", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60,
  graceMinutes: 15, weeklyOffDays: [5], effectiveFrom: null, effectiveTo: null,
}

const report = (overrides: Record<string, unknown> = {}) => ({
  id: "week-1", employeeId: "emp-1", weekStart: SUNDAY, status: "DRAFT",
  firstSubmittedAt: null, submittedLate: false, lastSubmittedAt: null,
  createdBy: "user-1", createdAt: SUNDAY, updatedAt: SUNDAY,
  notes: [], otherWork: [], copies: [],
  ...overrides,
})

const runsTransaction = () =>
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: unknown) =>
    typeof fn === "function" ? await (fn as (tx: unknown) => unknown)(prisma) : fn) as never)

beforeEach(() => {
  vi.clearAllMocks()
  runsTransaction()
  vi.setSystemTime(new Date("2026-09-17T11:00:00.000Z"))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as never)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({
    id: "emp-1", fullName: "Rahim", designation: "Pre-Sales Engineer", shiftId: "shift-1",
    joiningDate: day("2020-01-01"), lastWorkingDay: null,
  } as never)
  vi.mocked(prisma.shift.findMany).mockResolvedValue([GENERAL] as never)
  vi.mocked(prisma.holiday.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesAccount.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesCommunication.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.opportunity.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.event.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.salesTask.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.weeklyReport.findUnique).mockResolvedValue(report() as never)
  vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue(report() as never)
  vi.mocked(prisma.weeklyReport.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.weeklyReportCopy.create).mockResolvedValue({ id: "copy-1" } as never)
  vi.mocked(uploadBuffer).mockResolvedValue({ publicId: "sales/weekly/week-1/abc", bytes: 10 } as never)
})

describe("submitMyWeek", () => {
  it("renders the week, keeps the copy and marks it submitted", async () => {
    const file = await submitMyWeek({ week: "2026-09-13" }, USER)

    expect(assertMediaConfigured).toHaveBeenCalled()
    expect(renderWeeklyPdf).toHaveBeenCalled()
    expect(uploadBuffer).toHaveBeenCalled()
    expect(prisma.weeklyReportCopy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          weeklyReportId: "week-1",
          submittedBy: "user-1",
          fileId: "sales/weekly/week-1/abc",
          fileName: "Weekly Report – Rahim – 13–17 Sep 2026.pdf",
        }),
      })
    )
    expect(prisma.weeklyReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUBMITTED", submittedLate: false }) })
    )
    expect(file.fileName).toBe("Weekly Report – Rahim – 13–17 Sep 2026.pdf")
  })

  it("marks a report sent after the deadline as late", async () => {
    // 00:30 Dhaka on the Friday: the office Thursday is over.
    vi.setSystemTime(new Date("2026-09-17T18:30:00.000Z"))
    await submitMyWeek({ week: "2026-09-13" }, USER)
    expect(prisma.weeklyReport.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submittedLate: true }) })
    )
  })

  it("keeps the on-time mark and the first time when a reopened week is sent again", async () => {
    vi.setSystemTime(new Date("2026-09-19T05:00:00.000Z"))
    vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue(
      report({ status: "DRAFT", firstSubmittedAt: day("2026-09-17"), submittedLate: false }) as never
    )

    await submitMyWeek({ week: "2026-09-13" }, USER)

    const data = vi.mocked(prisma.weeklyReport.updateMany).mock.calls[0][0].data as Record<string, unknown>
    expect(data.firstSubmittedAt).toBeUndefined()
    expect(data.submittedLate).toBeUndefined()
    expect(data.status).toBe("SUBMITTED")
  })

  it("keeps nothing when the copy cannot be stored", async () => {
    vi.mocked(prisma.weeklyReportCopy.create).mockRejectedValue(new Error("write failed") as never)
    await expect(submitMyWeek({ week: "2026-09-13" }, USER)).rejects.toThrow()
    expect(destroyAsset).toHaveBeenCalledWith("sales/weekly/week-1/abc")
    expect(prisma.weeklyReport.update).not.toHaveBeenCalled()
  })

  it("creates and submits a week with only leave or holidays", async () => {
    vi.mocked(prisma.weeklyReport.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.weeklyReport.upsert).mockResolvedValue(report() as never)

    await expect(submitMyWeek({ week: "2026-09-13" }, USER)).resolves.toMatchObject({
      fileName: "Weekly Report – Rahim – 13–17 Sep 2026.pdf",
    })

    expect(prisma.weeklyReport.upsert).toHaveBeenCalled()
    expect(uploadBuffer).toHaveBeenCalled()
  })

  it("refuses a stale PDF when the week changed while it was being rendered", async () => {
    vi.mocked(prisma.weeklyReport.updateMany).mockResolvedValue({ count: 0 } as never)

    await expect(submitMyWeek({ week: "2026-09-13" }, USER)).rejects.toMatchObject({ statusCode: 409 })

    expect(prisma.weeklyReportCopy.create).not.toHaveBeenCalled()
    expect(destroyAsset).toHaveBeenCalledWith("sales/weekly/week-1/abc")
  })

  it("refuses a Sales Admin submitting somebody else's week", async () => {
    await expect(submitMyWeek({ week: "2026-09-13" }, ADMIN)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("getWeeklyCopy", () => {
  it("hands back a kept copy, exactly as it was submitted", async () => {
    vi.mocked(prisma.weeklyReportCopy.findFirst).mockResolvedValue({
      id: "copy-1", fileId: "sales/weekly/week-1/abc", fileName: "Weekly Report – Rahim – 13–17 Sep 2026.pdf",
    } as never)
    globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => Buffer.from("kept") })) as never

    const file = await getWeeklyCopy("copy-1", USER)
    expect(file.fileName).toBe("Weekly Report – Rahim – 13–17 Sep 2026.pdf")
    expect(file.pdf.toString()).toBe("kept")
  })

  it("refuses a copy that is not the reader's to see", async () => {
    vi.mocked(prisma.weeklyReportCopy.findFirst).mockResolvedValue(null as never)
    await expect(getWeeklyCopy("copy-9", USER)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("previewMyWeek", () => {
  it("renders the week, keeps nothing and changes nothing", async () => {
    const file = await previewMyWeek({ week: "2026-09-13" }, USER)

    expect(renderWeeklyPdf).toHaveBeenCalled()
    // A preview is a look, not a record: no file store, no copy, no status.
    expect(assertMediaConfigured).not.toHaveBeenCalled()
    expect(uploadBuffer).not.toHaveBeenCalled()
    expect(prisma.weeklyReportCopy.create).not.toHaveBeenCalled()
    expect(prisma.weeklyReport.update).not.toHaveBeenCalled()
    expect(file.fileName).toBe("DRAFT Weekly Report – Rahim – 13–17 Sep 2026.pdf")
  })

  it("previews a week nobody has written to yet, so the layout can be checked", async () => {
    vi.mocked(prisma.weeklyReport.findUnique).mockResolvedValue(null)
    await expect(previewMyWeek({ week: "2026-09-13" }, USER)).resolves.toBeTruthy()
  })

  it("is refused to a Sales Admin, who writes no week of their own", async () => {
    await expect(previewMyWeek({ week: "2026-09-13" }, ADMIN)).rejects.toMatchObject({ statusCode: 403 })
  })
})
