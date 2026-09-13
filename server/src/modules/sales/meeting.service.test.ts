import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn() },
    salesAccount: { findFirst: vi.fn() },
    opportunity: { findFirst: vi.fn() },
    employee: { findMany: vi.fn() },
    salesContact: { findMany: vi.fn() },
    salesMeeting: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    salesMeetingAttendee: { deleteMany: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { changeMeetingStatus, createMeeting, listMeetings, updateMeeting } from "./meeting.service"

const USER = {
  sub: "user-1", role: "EMPLOYEE", email: "rahim@demo.com",
  mustChangePassword: false, salesRole: "SALES_USER",
} as any

/** An employee with Sales Hub access unless a test says otherwise. */
const hubPerson = (id: string, fullName: string, salesRole: string | null = "SALES_USER") => ({
  id, fullName, employmentStatus: "ACTIVE", lastWorkingDay: null,
  user: { salesRole, isActive: true },
})

const meeting = (overrides: Record<string, unknown> = {}) => ({
  id: "meeting-1", salesAccountId: "account-1", opportunityId: null, title: "Firewall walkthrough",
  mode: "CUSTOMER_SITE", scheduledAt: new Date("2026-09-20T04:00:00.000Z"), endsAt: null,
  location: null, notes: null, status: "SCHEDULED", cancelReason: null, outcome: null,
  completedAt: null, createdBy: "user-1",
  createdAt: new Date("2026-09-13T06:00:00.000Z"), updatedAt: new Date("2026-09-13T06:00:00.000Z"),
  salesAccount: { name: "Bengal Group", ownerEmployeeId: "emp-1", assignments: [] },
  opportunity: null,
  attendees: [{
    id: "att-1", side: "OURS", employeeId: "emp-1", contactId: null, name: null, designation: null,
    employee: { fullName: "Rahim" }, contact: null,
  }],
  ...overrides,
})

/** 10:00 in Dhaka is 04:00 UTC. */
const BASE = {
  salesAccountId: "account-1", title: "Firewall walkthrough", scheduledAt: "2026-09-20T10:00:00+06:00",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  // The caller is emp-1 and works account-1 unless a test says otherwise.
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({ id: "account-1", ownerEmployeeId: "emp-1" } as any)
  vi.mocked(prisma.employee.findMany).mockImplementation((async (args: any) =>
    (args.where?.id?.in ?? []).map((id: string) => hubPerson(id, id === "emp-1" ? "Rahim" : id))) as never)
  // Every contact asked for belongs to the account unless a test says otherwise.
  vi.mocked(prisma.salesContact.findMany).mockImplementation((async (args: any) =>
    (args.where?.id?.in ?? []).map((id: string) => ({ id }))) as never)
  vi.mocked(prisma.salesMeeting.create).mockResolvedValue(meeting() as any)
  vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting() as any)
  vi.mocked(prisma.salesMeeting.update).mockImplementation((async (args: any) =>
    meeting({ ...args.data })) as never)
  vi.mocked(prisma.salesMeeting.findMany).mockResolvedValue([] as any)
})

const createData = () => (vi.mocked(prisma.salesMeeting.create).mock.calls[0][0] as any).data
const updateData = () => (vi.mocked(prisma.salesMeeting.update).mock.calls[0][0] as any).data

describe("scheduling a meeting", () => {
  it("schedules a meeting on an account the caller works, with the scheduler on our side", async () => {
    await createMeeting(BASE as any, USER)

    expect(createData()).toMatchObject({
      salesAccountId: "account-1", title: "Firewall walkthrough", mode: "CUSTOMER_SITE",
      createdBy: "user-1",
    })
    expect(createData().scheduledAt.toISOString()).toBe("2026-09-20T04:00:00.000Z")
    expect(createData().attendees.create).toEqual([
      expect.objectContaining({ side: "OURS", employeeId: "emp-1" }),
    ])
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_MEETING", action: "CREATE" }),
    }))
    // Sent against the account, so the account's Timeline shows it with no
    // second timeline system.
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: "sales.meeting.scheduled", entity: "SALES_ACCOUNT", entityId: "account-1",
      }),
    }))
  })

  it("refuses an account the caller can only see", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(createMeeting(BASE as any, USER)).rejects.toMatchObject({ statusCode: 404 })
    expect(prisma.salesMeeting.create).not.toHaveBeenCalled()
  })

  it("does not add the scheduler twice when they list themselves", async () => {
    await createMeeting({
      ...BASE,
      attendees: [{ side: "OURS", employeeId: "emp-1" }, { side: "OURS", employeeId: "emp-2" }],
    } as any, USER)

    const ours = createData().attendees.create.filter((a: any) => a.side === "OURS")
    expect(ours.map((a: any) => a.employeeId)).toEqual(["emp-1", "emp-2"])
  })

  it("refuses an our-side attendee without Sales Hub access, and names them", async () => {
    vi.mocked(prisma.employee.findMany).mockImplementation((async (args: any) =>
      (args.where?.id?.in ?? []).map((id: string) =>
        id === "emp-9" ? hubPerson(id, "Karim", null) : hubPerson(id, "Rahim"))) as never)

    await expect(createMeeting({
      ...BASE, attendees: [{ side: "OURS", employeeId: "emp-9" }],
    } as any, USER)).rejects.toThrow(/Karim/)
    expect(prisma.salesMeeting.create).not.toHaveBeenCalled()
  })

  it("takes their side as a saved contact of the account, or a typed name", async () => {
    await createMeeting({
      ...BASE,
      attendees: [
        { side: "THEIRS", contactId: "contact-1" },
        { side: "THEIRS", name: "Mr. Hasan", designation: "IT Head" },
      ],
    } as any, USER)

    expect(prisma.salesContact.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ["contact-1"] }, salesAccountId: "account-1" },
    }))
    expect(createData().attendees.create).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "THEIRS", contactId: "contact-1" }),
      expect.objectContaining({ side: "THEIRS", name: "Mr. Hasan", designation: "IT Head" }),
    ]))
  })

  it("refuses a contact that belongs to another account", async () => {
    vi.mocked(prisma.salesContact.findMany).mockResolvedValue([] as any)

    await expect(createMeeting({
      ...BASE, attendees: [{ side: "THEIRS", contactId: "contact-9" }],
    } as any, USER)).rejects.toThrow(/contact/i)
  })

  it("refuses a deal that belongs to another account", async () => {
    vi.mocked(prisma.opportunity.findFirst).mockResolvedValue(null)

    await expect(createMeeting({ ...BASE, opportunityId: "opp-9" } as any, USER))
      .rejects.toThrow(/deal/i)
    expect(prisma.opportunity.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "opp-9", salesAccountId: "account-1" },
    }))
  })
})

describe("changing a meeting", () => {
  it("treats a new time as a reschedule: audited, on the Timeline, and the status stays", async () => {
    await updateMeeting("meeting-1", { scheduledAt: "2026-09-21T10:00:00+06:00" } as any, USER)

    expect(updateData().scheduledAt.toISOString()).toBe("2026-09-21T04:00:00.000Z")
    expect(updateData()).not.toHaveProperty("status")
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "SALES_MEETING", action: "UPDATE" }),
    }))
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "sales.meeting.rescheduled", entityId: "account-1" }),
    }))
  })

  it("refuses to move a meeting that is no longer scheduled", async () => {
    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting({ status: "COMPLETED" }) as any)

    await expect(updateMeeting("meeting-1", { scheduledAt: "2026-09-21T10:00:00+06:00" } as any, USER))
      .rejects.toThrow(/scheduled/i)
    expect(prisma.salesMeeting.update).not.toHaveBeenCalled()
  })

  it("lets the notes of a completed meeting be corrected", async () => {
    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting({ status: "COMPLETED" }) as any)

    await updateMeeting("meeting-1", { notes: "Signed on the day" } as any, USER)

    expect(updateData()).toMatchObject({ notes: "Signed on the day" })
  })

  it("refuses somebody who does not work the account", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(updateMeeting("meeting-1", { notes: "x" } as any, USER))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})

describe("ending a meeting", () => {
  it("completes it with an optional outcome, in one transaction with its audit row", async () => {
    await changeMeetingStatus("meeting-1", { status: "COMPLETED", outcome: "Wants a quote" } as any, USER)

    expect(updateData()).toMatchObject({ status: "COMPLETED", outcome: "Wants a quote" })
    expect(updateData().completedAt).toBeInstanceOf(Date)
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1)
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "sales.meeting.completed" }),
    }))
  })

  it("cancels it with a reason", async () => {
    await changeMeetingStatus("meeting-1", { status: "CANCELLED", reason: "Customer travelling" } as any, USER)

    expect(updateData()).toMatchObject({ status: "CANCELLED", cancelReason: "Customer travelling" })
    expect(prisma.event.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "sales.meeting.cancelled" }),
    }))
  })

  it("puts a cancelled meeting back to scheduled and clears the reason", async () => {
    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(
      meeting({ status: "CANCELLED", cancelReason: "Customer travelling" }) as any
    )

    await changeMeetingStatus("meeting-1", { status: "SCHEDULED" } as any, USER)

    expect(updateData()).toMatchObject({ status: "SCHEDULED", cancelReason: null })
  })

  it("never reopens or cancels a completed meeting", async () => {
    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting({ status: "COMPLETED" }) as any)

    await expect(changeMeetingStatus("meeting-1", { status: "SCHEDULED" } as any, USER))
      .rejects.toThrow(/completed/i)
    await expect(changeMeetingStatus("meeting-1", { status: "CANCELLED", reason: "x" } as any, USER))
      .rejects.toThrow(/completed/i)
    expect(prisma.salesMeeting.update).not.toHaveBeenCalled()
  })

  it("refuses to complete a cancelled meeting until it is put back", async () => {
    vi.mocked(prisma.salesMeeting.findFirst).mockResolvedValue(meeting({ status: "CANCELLED" }) as any)

    await expect(changeMeetingStatus("meeting-1", { status: "COMPLETED" } as any, USER))
      .rejects.toThrow(/back/i)
  })
})

describe("listing meetings", () => {
  it("lists in time order, with the filters it was given", async () => {
    await listMeetings({
      salesAccountId: "account-1", from: "2026-09-20T00:00:00+06:00", to: "2026-09-27T00:00:00+06:00",
    } as any, USER)

    const args = vi.mocked(prisma.salesMeeting.findMany).mock.calls[0][0] as any
    expect(args.where.salesAccountId).toBe("account-1")
    expect(args.where.scheduledAt.gte.toISOString()).toBe("2026-09-19T18:00:00.000Z")
    expect(args.where.scheduledAt.lt.toISOString()).toBe("2026-09-26T18:00:00.000Z")
    expect(args.orderBy).toEqual({ scheduledAt: "asc" })
  })

  it("reads mine as the meetings I attend on our side", async () => {
    await listMeetings({ mine: true } as any, USER)

    const args = vi.mocked(prisma.salesMeeting.findMany).mock.calls[0][0] as any
    expect(args.where.attendees).toEqual({ some: { side: "OURS", employeeId: "emp-1" } })
  })
})
