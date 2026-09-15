import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    salesMeetingMinutes: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    salesMinutesSend: { create: vi.fn(), findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))
vi.mock("./minutes.pdf", async (original) => ({
  ...(await original<typeof import("./minutes.pdf")>()),
  renderMinutesPdf: vi.fn(),
}))
vi.mock("../media/media.service", () => ({ uploadBuffer: vi.fn(), destroyAsset: vi.fn(), signedDocumentUrl: vi.fn() }))
vi.mock("../media/media.provider", () => ({ assertMediaConfigured: vi.fn(), isMediaConfigured: vi.fn(() => true) }))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { assertMediaConfigured } from "../media/media.provider"
import { destroyAsset, signedDocumentUrl, uploadBuffer } from "../media/media.service"
import { renderMinutesPdf } from "./minutes.pdf"
import { getSentCopy, previewMinutes, sendMinutes } from "./minutes.send"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "rahim@demo.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any

const UPDATED = new Date("2026-09-15T03:00:00.000Z")
const PDF = Buffer.from("%PDF-final")
const FILE_ID = "sales/minutes/minutes-1/abc"
const FILE_NAME = "Meeting Minutes – APS Group – 13 Sep 2026.pdf"

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "minutes-1", meetingId: "meeting-1", purpose: null, meetingWithNote: null, requirementFound: true,
  status: "DRAFT", lastSentAt: null, createdBy: "user-1", updatedBy: "user-1", createdAt: UPDATED, updatedAt: UPDATED,
  meeting: {
    id: "meeting-1", salesAccountId: "account-1", opportunityId: null, title: "Introduction",
    mode: "CUSTOMER_SITE", status: "COMPLETED", scheduledAt: new Date("2026-09-13T05:00:00.000Z"),
    endsAt: null, location: null, createdBy: "user-1",
    salesAccount: { name: "APS Group", ownerEmployeeId: "emp-1" }, opportunity: null, attendees: [], originated: [],
  },
  sections: [],
  preparers: [{
    id: "p1", employeeId: "emp-1", titleExtra: null, order: 0,
    employee: { fullName: "Rahim", designation: "Pre-Sales Engineer" },
  }],
  sends: [],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "user-1", email: "rahim@demo.com", displayName: null, employee: { fullName: "Rahim" } },
  ] as any)
  vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(row() as any)
  // Nobody saved the minutes while the PDF was being made, unless a test says so.
  vi.mocked(prisma.salesMeetingMinutes.findUnique).mockResolvedValue({ updatedAt: UPDATED } as any)
  vi.mocked(prisma.salesMinutesSend.create).mockResolvedValue({ id: "send-1" } as any)
  vi.mocked(renderMinutesPdf).mockResolvedValue(PDF)
  vi.mocked(uploadBuffer).mockResolvedValue({ publicId: FILE_ID, version: 1, bytes: PDF.length, format: "pdf" })
  vi.mocked(signedDocumentUrl).mockReturnValue({ url: "https://files.example/kept.pdf", expiresAt: "2026-09-15T04:05:00.000Z" })
  vi.mocked(assertMediaConfigured).mockImplementation(() => undefined)
})

afterEach(() => vi.unstubAllGlobals())

describe("the preview", () => {
  it("is a PDF marked DRAFT, and keeps nothing", async () => {
    const preview = await previewMinutes("minutes-1", USER)

    expect(renderMinutesPdf).toHaveBeenCalledWith(expect.objectContaining({ accountName: "APS Group" }), true)
    expect(preview).toEqual({ pdf: PDF, fileName: FILE_NAME })
    expect(uploadBuffer).not.toHaveBeenCalled()
    expect(prisma.salesMinutesSend.create).not.toHaveBeenCalled()
  })
})

describe("downloading for sending", () => {
  it("keeps the final copy, records the send, marks the minutes sent, and hands back that same file", async () => {
    const sent = await sendMinutes("minutes-1", { sentTo: "Md. Salim Reza, by email" }, USER)

    expect(renderMinutesPdf).toHaveBeenCalledWith(expect.anything(), false)
    expect(uploadBuffer).toHaveBeenCalledWith(PDF, expect.stringMatching(/^sales\/minutes\/minutes-1\//))
    expect(sent).toEqual({ pdf: PDF, fileName: FILE_NAME })

    expect(prisma.salesMinutesSend.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        minutesId: "minutes-1", sentBy: "user-1", sentTo: "Md. Salim Reza, by email",
        fileId: FILE_ID, fileName: FILE_NAME,
      }),
    })
    const update = vi.mocked(prisma.salesMeetingMinutes.update).mock.calls[0][0] as any
    expect(update.where).toEqual({ id: "minutes-1" })
    expect(update.data.status).toBe("SENT")
    expect(update.data.lastSentAt).toBeInstanceOf(Date)
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_MINUTES", action: "SEND", note: "Sent to Md. Salim Reza, by email" }),
    }))
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "sales.minutes.sent", entity: "SALES_ACCOUNT", entityId: "account-1",
        payload: { meetingId: "meeting-1", opportunityId: null, minutesId: "minutes-1" },
      }),
    }))
  })

  it("refuses before the requirement question is answered, for a meeting with no deal", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(row({ requirementFound: null }) as any)

    await expect(sendMinutes("minutes-1", {}, USER)).rejects.toThrow(/requirement/)
    expect(renderMinutesPdf).not.toHaveBeenCalled()
  })

  it("does not ask the question of a meeting that has a deal", async () => {
    const withDeal = row({ requirementFound: null })
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue({
      ...withDeal, meeting: { ...withDeal.meeting, opportunityId: "opp-1", opportunity: { serial: "BS-OPP-00001", name: "Firewall" } },
    } as any)

    await expect(sendMinutes("minutes-1", {}, USER)).resolves.toMatchObject({ fileName: FILE_NAME })
  })

  it("refuses with nobody under Prepared by", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(row({ preparers: [] }) as any)

    await expect(sendMinutes("minutes-1", {}, USER)).rejects.toThrow(/Prepared by/)
    expect(renderMinutesPdf).not.toHaveBeenCalled()
  })

  it("refuses, and removes the upload, when the minutes were saved while the PDF was being made", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findUnique).mockResolvedValue({ updatedAt: new Date(UPDATED.getTime() + 1000) } as any)

    await expect(sendMinutes("minutes-1", {}, USER)).rejects.toMatchObject({ statusCode: 409 })
    expect(destroyAsset).toHaveBeenCalledWith(FILE_ID)
    expect(prisma.salesMinutesSend.create).not.toHaveBeenCalled()
  })

  it("records nothing when the file store refuses the upload", async () => {
    vi.mocked(uploadBuffer).mockRejectedValue(new AppError(502, "Upload to the file store failed. Please try again."))

    await expect(sendMinutes("minutes-1", {}, USER)).rejects.toMatchObject({ statusCode: 502 })
    expect(prisma.salesMinutesSend.create).not.toHaveBeenCalled()
    expect(prisma.salesMeetingMinutes.update).not.toHaveBeenCalled()
  })

  it("refuses before making anything when there is no file store to keep the copy in", async () => {
    vi.mocked(assertMediaConfigured).mockImplementation(() => {
      throw new AppError(503, "File storage is not configured on this server")
    })

    await expect(sendMinutes("minutes-1", {}, USER)).rejects.toMatchObject({ statusCode: 503 })
    expect(renderMinutesPdf).not.toHaveBeenCalled()
  })
})

describe("a kept copy", () => {
  it("is fetched from the file store as it was sent, for someone who works the account", async () => {
    vi.mocked(prisma.salesMinutesSend.findFirst).mockResolvedValue({ id: "send-1", fileId: FILE_ID, fileName: FILE_NAME } as any)
    const fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode("%PDF-kept").buffer })
    vi.stubGlobal("fetch", fetch)

    const copy = await getSentCopy("send-1", USER)

    expect((vi.mocked(prisma.salesMinutesSend.findFirst).mock.calls[0][0] as any).where).toEqual({
      id: "send-1",
      minutes: { meeting: { salesAccount: { OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }] } } },
    })
    expect(signedDocumentUrl).toHaveBeenCalledWith(FILE_ID, "pdf")
    expect(fetch).toHaveBeenCalledWith("https://files.example/kept.pdf", expect.anything())
    expect(copy.fileName).toBe(FILE_NAME)
    expect(copy.pdf.toString()).toBe("%PDF-kept")
  })

  it("is not found for anyone else", async () => {
    vi.mocked(prisma.salesMinutesSend.findFirst).mockResolvedValue(null)

    await expect(getSentCopy("send-1", USER)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("says so when the file store cannot hand it back", async () => {
    vi.mocked(prisma.salesMinutesSend.findFirst).mockResolvedValue({ id: "send-1", fileId: FILE_ID, fileName: FILE_NAME } as any)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }))

    await expect(getSentCopy("send-1", USER)).rejects.toMatchObject({ statusCode: 502 })
  })
})
