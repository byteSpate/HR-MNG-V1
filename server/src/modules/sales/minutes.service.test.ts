import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    employee: { findMany: vi.fn() },
    salesAccount: { findFirst: vi.fn() },
    opportunity: { findFirst: vi.fn() },
    salesMeeting: { findFirst: vi.fn() },
    salesMeetingMinutes: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn() },
    salesMinutesSection: { deleteMany: vi.fn() },
    salesMinutesPreparer: { deleteMany: vi.fn() },
    salesMinutesTemplate: { findUnique: vi.fn() },
    salesTask: { create: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    event: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import {
  answerRequirement, deleteMinutes, getMinutes, listMinutes, saveMinutes, startMinutes,
} from "./minutes.service"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "rahim@demo.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any
/** Seeded with no employee record. */
const SUPER = {
  sub: "user-super", role: "SUPER_ADMIN", email: "super@demo.com",
  mustChangePassword: false, salesRole: null,
} as any

const NOW = new Date("2026-09-15T04:00:00.000Z")

/** A completed meeting on APS Group, 11:00 to 12:00 in Dhaka on 13 Sep. */
const meeting = (overrides: Record<string, unknown> = {}) => ({
  id: "meeting-1", salesAccountId: "account-1", opportunityId: null, title: "Introduction",
  mode: "CUSTOMER_SITE", status: "COMPLETED", outcome: "Productive.",
  scheduledAt: new Date("2026-09-13T05:00:00.000Z"), endsAt: new Date("2026-09-13T06:00:00.000Z"),
  location: "Uttara, Dhaka", createdBy: "user-1",
  salesAccount: { name: "APS Group", ownerEmployeeId: "emp-1" },
  opportunity: null,
  attendees: [
    {
      side: "OURS", employeeId: "emp-1", contactId: null, name: null, designation: null,
      employee: { fullName: "Rahim", designation: "Pre-Sales Engineer" }, contact: null,
    },
    {
      side: "THEIRS", employeeId: null, contactId: "contact-1", name: null, designation: null,
      employee: null, contact: { name: "Md. Salim Reza", designation: "Deputy Manager – IT" },
    },
  ],
  originated: [],
  minutes: null,
  ...overrides,
})

const minutesRow = (overrides: Record<string, unknown> = {}) => ({
  id: "minutes-1", meetingId: "meeting-1", purpose: null, meetingWithNote: null, requirementFound: null,
  status: "DRAFT", lastSentAt: null, createdBy: "user-1", updatedBy: "user-1", createdAt: NOW, updatedAt: NOW,
  meeting: meeting(),
  sections: [
    { id: "s1", order: 0, heading: "Meeting Summary", kind: "PARAGRAPHS", content: { paragraphs: ["Held."] } },
    {
      id: "s2", order: 1, heading: "Next Steps", kind: "TABLE",
      content: { rows: [{ actionItem: "Send the quote", responsible: "Us", status: "Open", taskId: "task-9" }] },
    },
  ],
  preparers: [
    {
      id: "p1", employeeId: "emp-1", titleExtra: "(Cloud & Cybersecurity)", order: 0,
      employee: { fullName: "Rahim", designation: "Pre-Sales Engineer" },
    },
  ],
  sends: [],
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  // The caller is emp-1 and works account-1 unless a test says otherwise.
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.user.findMany).mockResolvedValue([
    { id: "user-1", email: "rahim@demo.com", displayName: null, employee: { fullName: "Rahim" } },
  ] as any)
  vi.mocked(prisma.employee.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "account-1", ownerEmployeeId: "emp-1" } as any)
  vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting() as any)
  vi.mocked(prisma.salesMinutesTemplate.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.salesMeetingMinutes.create).mockResolvedValue({ id: "minutes-1" } as any)
  vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(minutesRow() as any)
  vi.mocked(prisma.salesMeetingMinutes.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.salesMeetingMinutes.update).mockResolvedValue({ id: "minutes-1" } as any)
  vi.mocked(prisma.salesTask.create).mockResolvedValue({ id: "task-new" } as any)
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as any)
})

describe("starting minutes", () => {
  it("starts from the template, with the outcome note and the writer under Prepared by", async () => {
    const result = await startMinutes("meeting-1", USER)

    expect(result).toEqual({ id: "minutes-1", created: true })
    const data = (vi.mocked(prisma.salesMeetingMinutes.create).mock.calls[0][0] as any).data
    expect(data).toMatchObject({ meetingId: "meeting-1", createdBy: "user-1" })
    expect(data.sections.create.map((s: any) => s.heading)).toEqual([
      "Meeting Summary", "Key Discussion Points", "Next Steps", "Meeting Outcome",
    ])
    expect(data.sections.create[3]).toEqual({
      order: 3, heading: "Meeting Outcome", kind: "PARAGRAPHS", content: { paragraphs: ["Productive."] },
    })
    expect(data.preparers.create).toEqual([{ employeeId: "emp-1", order: 0 }])
  })

  it("is only for someone who works the account", async () => {
    await startMinutes("meeting-1", USER)
    const where = (vi.mocked(prisma.salesMeeting.findFirst).mock.calls[0][0] as any).where
    expect(where).toEqual({
      id: "meeting-1",
      salesAccount: { OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }] },
    })

    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(null)
    await expect(startMinutes("meeting-1", USER)).rejects.toMatchObject({ statusCode: 404 })
  })

  it("writes an audit row and a Minutes written line for the account's Timeline, naming the meeting and its deal", async () => {
    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting({ opportunityId: "opp-1" }) as any)

    await startMinutes("meeting-1", USER)

    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_MINUTES", entityId: "minutes-1", action: "CREATE", note: "Minutes started" }),
    }))
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "sales.minutes.written", entity: "SALES_ACCOUNT", entityId: "account-1",
        subjectEmployeeId: "emp-1",
        payload: { meetingId: "meeting-1", opportunityId: "opp-1", minutesId: "minutes-1" },
      }),
    }))
  })

  it("refuses a meeting that has not happened yet", async () => {
    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting({ status: "SCHEDULED" }) as any)

    await expect(startMinutes("meeting-1", USER)).rejects.toThrow(/completed/)
    expect(prisma.salesMeetingMinutes.create).not.toHaveBeenCalled()
  })

  it("opens the same minutes when they were already started", async () => {
    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting({ minutes: { id: "minutes-7" } }) as any)

    await expect(startMinutes("meeting-1", USER)).resolves.toEqual({ id: "minutes-7", created: false })
    expect(prisma.salesMeetingMinutes.create).not.toHaveBeenCalled()
  })

  it("starts with nobody under Prepared by for a login with no employee record", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as any)

    await startMinutes("meeting-1", SUPER)

    const data = (vi.mocked(prisma.salesMeetingMinutes.create).mock.calls[0][0] as any).data
    expect(data.preparers).toBeUndefined()
  })
})

describe("reading minutes", () => {
  it("is refused, in the not-found words, to someone who does not work the account", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(null)

    await expect(getMinutes("minutes-1", USER)).rejects.toMatchObject({
      statusCode: 404, message: "Those minutes do not exist, or are not yours",
    })
    const where = (vi.mocked(prisma.salesMeetingMinutes.findFirst).mock.calls[0][0] as any).where
    expect(where.meeting).toEqual({
      salesAccount: { OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }] },
    })
  })

  it("reads the header live from the meeting, with the attendees and who prepared it", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: "a1", action: "CREATE", note: "Minutes started", changedBy: "user-1", changedAt: NOW, before: null, after: null },
    ] as any)

    const minutes = await getMinutes("minutes-1", USER)

    expect(minutes.title).toBe("Meeting Minutes – APS Group")
    expect(minutes.subtitle).toBe("Introduction")
    expect(minutes.header).toEqual(expect.arrayContaining([
      { label: "Date", value: "13 Sep 2026" },
      { label: "Time", value: "11:00 AM – 12:00 PM" },
      { label: "Location", value: "Uttara, Dhaka" },
      { label: "Meeting With", value: "APS Group" },
      { label: "Arranged by", value: "Rahim" },
    ]))
    expect(minutes.header).toContainEqual({ label: "On Behalf Of", value: minutes.companyName })
    expect(minutes.attendees).toEqual([
      { side: "OURS", name: "Rahim", designation: "Pre-Sales Engineer" },
      { side: "THEIRS", name: "Md. Salim Reza", designation: "Deputy Manager – IT" },
    ])
    expect(minutes.preparers).toEqual([
      { employeeId: "emp-1", name: "Rahim", title: "Pre-Sales Engineer", titleExtra: "(Cloud & Cybersecurity)" },
    ])
    expect(minutes.sections[0]).toEqual({ heading: "Meeting Summary", kind: "PARAGRAPHS", content: { paragraphs: ["Held."] } })
    expect(minutes.history).toEqual([{ id: "a1", at: NOW.toISOString(), byName: "Rahim", text: "Minutes started" }])
    expect(minutes.fileName).toBe("Meeting Minutes – APS Group – 13 Sep 2026.pdf")
  })

  it("asks the requirement question only for a meeting with no deal, and allows deleting only before a send", async () => {
    const draft = await getMinutes("minutes-1", USER)
    expect(draft.asksRequirement).toBe(true)
    expect(draft.requirementLocked).toBe(false)
    expect(draft.canDelete).toBe(true)

    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(minutesRow({
      status: "SENT", lastSentAt: NOW,
      meeting: meeting({ opportunityId: "opp-1", opportunity: { serial: "BS-OPP-00001", name: "Firewall" } }),
      sends: [{ id: "send-1", sentAt: NOW, sentBy: "user-1", sentTo: "Md. Salim Reza, by email", fileId: "f", fileName: "x.pdf" }],
    }) as any)
    const sent = await getMinutes("minutes-1", USER)
    expect(sent.asksRequirement).toBe(false)
    expect(sent.requirementLocked).toBe(true)
    expect(sent.canDelete).toBe(false)
    expect(sent.sends).toEqual([
      { id: "send-1", sentAt: NOW.toISOString(), sentByName: "Rahim", sentTo: "Md. Salim Reza, by email", fileName: "x.pdf" },
    ])
  })
})

describe("saving minutes", () => {
  const BODY = {
    purpose: "  Introduce our services ",
    meetingWithNote: "IT Department",
    sections: [
      { heading: "Meeting Summary", kind: "PARAGRAPHS", content: { paragraphs: ["Held.", ""] } },
      {
        heading: "Next Steps",
        kind: "TABLE",
        content: {
          rows: [
            // Already made its task, which stays linked.
            { actionItem: "Send the quote", responsible: "Us", status: "Open", taskId: "task-9" },
            // Ticked just now.
            { actionItem: "Arrange a demo", responsible: "Both Parties", status: "", taskId: null, newTask: { dueOn: "2026-09-30" } },
            // A task id the server never made.
            { actionItem: "Forged", responsible: "", status: "", taskId: "task-forged" },
          ],
        },
      },
    ],
    preparers: [{ employeeId: "emp-1", titleExtra: "(Cloud & Cybersecurity)" }],
  }

  it("replaces the sections and Prepared by, cleaned and in order, and writes one audit row", async () => {
    await saveMinutes("minutes-1", BODY as any, USER)

    expect(prisma.salesMinutesSection.deleteMany).toHaveBeenCalledWith({ where: { minutesId: "minutes-1" } })
    expect(prisma.salesMinutesPreparer.deleteMany).toHaveBeenCalledWith({ where: { minutesId: "minutes-1" } })
    const data = (vi.mocked(prisma.salesMeetingMinutes.update).mock.calls[0][0] as any).data
    expect(data).toMatchObject({ purpose: "Introduce our services", meetingWithNote: "IT Department", updatedBy: "user-1" })
    expect(data.sections.create[0]).toEqual({
      order: 0, heading: "Meeting Summary", kind: "PARAGRAPHS", content: { paragraphs: ["Held."] },
    })
    expect(data.preparers.create).toEqual([{ employeeId: "emp-1", titleExtra: "(Cloud & Cybersecurity)", order: 0 }])
    expect(data.status).toBeUndefined()
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_MINUTES", action: "UPDATE", note: "Minutes edited" }),
    }))
  })

  it("makes one task for the writer from a ticked row, keeps a task it made, and drops one it did not", async () => {
    await saveMinutes("minutes-1", BODY as any, USER)

    expect(prisma.salesTask.create).toHaveBeenCalledTimes(1)
    const task = (vi.mocked(prisma.salesTask.create).mock.calls[0][0] as any).data
    expect(task).toMatchObject({
      title: "Arrange a demo", meetingId: "meeting-1", salesAccountId: "account-1",
      assignedToEmployeeId: "emp-1", origin: "SELF",
    })
    expect(task.dueOn.toISOString()).toBe("2026-09-30T00:00:00.000Z")

    const data = (vi.mocked(prisma.salesMeetingMinutes.update).mock.calls[0][0] as any).data
    expect(data.sections.create[1].content.rows.map((row: any) => row.taskId)).toEqual(["task-9", "task-new", null])
    expect(data.sections.create[1].content.rows[1]).not.toHaveProperty("newTask")
  })

  it("does not make a second task for a row that already has one", async () => {
    await saveMinutes("minutes-1", {
      ...BODY,
      sections: [{
        heading: "Next Steps", kind: "TABLE",
        content: { rows: [{ actionItem: "Send the quote", responsible: "Us", status: "Open", taskId: "task-9", newTask: { dueOn: "2026-09-30" } }] },
      }],
    } as any, USER)

    expect(prisma.salesTask.create).not.toHaveBeenCalled()
  })

  it("refuses a newly added preparer without Sales Hub access and names them, and does not re-check those already there", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([{
      id: "emp-9", fullName: "Karim", employmentStatus: "ACTIVE", lastWorkingDay: null,
      user: { salesRole: null, isActive: true },
    }] as any)

    await expect(saveMinutes("minutes-1", {
      ...BODY, preparers: [{ employeeId: "emp-1", titleExtra: null }, { employeeId: "emp-9", titleExtra: null }],
    } as any, USER)).rejects.toThrow(/Karim/)
    expect((vi.mocked(prisma.employee.findMany).mock.calls[0][0] as any).where).toEqual({ id: { in: ["emp-9"] } })
    expect(prisma.salesMeetingMinutes.update).not.toHaveBeenCalled()
  })

  it("marks sent minutes as edited after sending", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(minutesRow({ status: "SENT", lastSentAt: NOW }) as any)

    await saveMinutes("minutes-1", BODY as any, USER)

    expect((vi.mocked(prisma.salesMeetingMinutes.update).mock.calls[0][0] as any).data.status).toBe("EDITED_AFTER_SENDING")
  })
})

describe("the requirement question", () => {
  it("records the answer", async () => {
    await answerRequirement("minutes-1", { found: true }, USER)

    expect(prisma.salesMeetingMinutes.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "minutes-1" }, data: expect.objectContaining({ requirementFound: true }),
    }))
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_MINUTES", note: "Requirement found" }),
    }))
  })

  it("is not asked for a meeting that already has a deal", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(minutesRow({
      meeting: meeting({ opportunityId: "opp-1" }),
    }) as any)

    await expect(answerRequirement("minutes-1", { found: false }, USER)).rejects.toThrow(/already has a deal/)
  })

  it("is fixed once the minutes have been sent", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(minutesRow({ status: "SENT", lastSentAt: NOW }) as any)

    await expect(answerRequirement("minutes-1", { found: false }, USER)).rejects.toThrow(/sent/)
    expect(prisma.salesMeetingMinutes.update).not.toHaveBeenCalled()
  })

  it("records nothing when the same answer is given again, so History gets no second line", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(minutesRow({ requirementFound: false }) as any)

    const minutes = await answerRequirement("minutes-1", { found: false }, USER)

    expect(prisma.salesMeetingMinutes.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
    expect(minutes.requirementFound).toBe(false)
  })
})

describe("deleting minutes", () => {
  it("deletes minutes that were never sent, with an audit row", async () => {
    await deleteMinutes("minutes-1", USER)

    expect(prisma.salesMeetingMinutes.delete).toHaveBeenCalledWith({ where: { id: "minutes-1" } })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_MINUTES", action: "DELETE" }),
    }))
  })

  it("keeps sent minutes as a record", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findFirst).mockResolvedValue(minutesRow({
      status: "SENT", lastSentAt: NOW,
      sends: [{ id: "send-1", sentAt: NOW, sentBy: "user-1", sentTo: null, fileId: "f", fileName: "x.pdf" }],
    }) as any)

    await expect(deleteMinutes("minutes-1", USER)).rejects.toThrow(/record/)
    expect(prisma.salesMeetingMinutes.delete).not.toHaveBeenCalled()
  })
})

describe("the list of minutes", () => {
  it("covers the accounts the caller works, with Mine only and the status filter", async () => {
    await listMinutes({ mine: true, status: "SENT" }, USER)

    const args = vi.mocked(prisma.salesMeetingMinutes.findMany).mock.calls[0][0] as any
    expect(args.where).toEqual({
      meeting: { salesAccount: { OR: [{ ownerEmployeeId: "emp-1" }, { assignments: { some: { employeeId: "emp-1" } } }] } },
      status: "SENT",
      OR: [{ createdBy: "user-1" }, { preparers: { some: { employeeId: "emp-1" } } }],
    })
    expect(args.orderBy).toEqual({ meeting: { scheduledAt: "desc" } })
  })

  it("names the meeting, the account and who prepared it", async () => {
    vi.mocked(prisma.salesMeetingMinutes.findMany).mockResolvedValue([minutesRow({ status: "EDITED_AFTER_SENDING", lastSentAt: NOW })] as any)

    const { items } = await listMinutes({}, USER)

    expect(items).toEqual([{
      id: "minutes-1", meetingId: "meeting-1", meetingTitle: "Introduction",
      scheduledAt: "2026-09-13T05:00:00.000Z", salesAccountId: "account-1", salesAccountName: "APS Group",
      preparedBy: ["Rahim"], status: "EDITED_AFTER_SENDING", lastSentAt: NOW.toISOString(),
    }])
  })
})
