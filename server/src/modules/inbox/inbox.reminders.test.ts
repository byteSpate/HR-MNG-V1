import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    notification: { createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    salesMeeting: { findMany: vi.fn() },
    salesTask: { findMany: vi.fn() },
    shift: { findMany: vi.fn() },
    holiday: { findMany: vi.fn() },
    attendance: { findMany: vi.fn() },
    assetAssignment: { findMany: vi.fn() },
    leaveRequest: { findMany: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import {
  remindAssetsNotAccepted,
  remindLeaveTomorrow,
  remindMeetingsSoon,
  remindNotCheckedOut,
  remindTasksDueAndLate,
  remindWaitingTwoDays,
} from "./inbox.reminders"

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
// 12:00 in Dhaka (UTC+6) on Tuesday 10 November 2026.
const NOW = new Date("2026-11-10T06:00:00.000Z")
const TODAY = new Date("2026-11-10T00:00:00.000Z")

const written = () => db.notification.createMany.mock.calls.flatMap((c: any[]) => c[0].data)

beforeEach(() => {
  vi.clearAllMocks()
  // Every user named is active unless a test says otherwise.
  db.user.findMany.mockImplementation(async ({ where }: any) => (where.id.in as string[]).map((id) => ({ id })))
  db.shift.findMany.mockResolvedValue([])
  db.holiday.findMany.mockResolvedValue([])
})

describe("remindMeetingsSoon", () => {
  it("reminds our people in a meeting starting within 30 minutes", async () => {
    const at = new Date("2026-11-10T06:20:00.000Z")
    db.salesMeeting.findMany.mockResolvedValue([
      {
        id: "m-1",
        title: "Demo for Acme",
        scheduledAt: at,
        salesAccountId: "acc-1",
        attendees: [{ employee: { userId: "u-1" } }, { employee: { userId: "u-2" } }],
      },
    ])

    await expect(remindMeetingsSoon(NOW)).resolves.toBe(2)

    const where = db.salesMeeting.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      status: "SCHEDULED",
      scheduledAt: { gt: NOW, lte: new Date("2026-11-10T06:30:00.000Z") },
    })
    expect(written()).toEqual([
      expect.objectContaining({
        userId: "u-1",
        tab: "IMPORTANT",
        kind: "reminder.meeting_30min",
        entity: "SALES_MEETING",
        entityId: "m-1",
        title: "Your meeting starts in 30 minutes",
        meta: "Demo for Acme · 12:20",
        href: "/accounts/acc-1",
        dedupeKey: `meeting-30min:m-1:${at.toISOString()}:u-1`,
      }),
      expect.objectContaining({ userId: "u-2", dedupeKey: `meeting-30min:m-1:${at.toISOString()}:u-2` }),
    ])
    expect(db.notification.createMany.mock.calls[0][0].skipDuplicates).toBe(true)
  })

  it("writes nothing when no meeting is close", async () => {
    db.salesMeeting.findMany.mockResolvedValue([])
    await expect(remindMeetingsSoon(NOW)).resolves.toBe(0)
    expect(db.notification.createMany).not.toHaveBeenCalled()
  })
})

describe("remindTasksDueAndLate", () => {
  it("reminds about a task due today and one that became late yesterday", async () => {
    db.salesTask.findMany.mockResolvedValue([
      { id: "t-1", title: "Call Rahim", dueOn: TODAY, assignedTo: { userId: "u-1", shiftId: null } },
      {
        id: "t-2",
        title: "Send quote",
        dueOn: new Date("2026-11-09T00:00:00.000Z"),
        assignedTo: { userId: "u-1", shiftId: null },
      },
    ])

    await remindTasksDueAndLate(NOW)

    expect(db.salesTask.findMany.mock.calls[0][0].where).toMatchObject({ status: "PENDING" })
    expect(written()).toEqual([
      expect.objectContaining({ title: "Task due today", meta: "Call Rahim", dedupeKey: "task-due:t-1", href: "/tasks" }),
      expect.objectContaining({ title: "Task is late", meta: "Send quote", dedupeKey: "task-late:t-2" }),
    ])
  })

  it("does not remind on the person's weekly off day", async () => {
    // Tuesday is getUTCDay() 2.
    db.shift.findMany.mockResolvedValue([
      { id: "s-1", weeklyOffDays: [2], isDefault: true, effectiveFrom: null, effectiveTo: null, startTime: "09:00", endTime: "18:00", graceMinutes: 0 },
    ])
    db.salesTask.findMany.mockResolvedValue([
      { id: "t-1", title: "Call Rahim", dueOn: TODAY, assignedTo: { userId: "u-1", shiftId: "s-1" } },
    ])

    await expect(remindTasksDueAndLate(NOW)).resolves.toBe(0)
  })
})

describe("remindNotCheckedOut", () => {
  it("reminds people still checked in today", async () => {
    db.attendance.findMany.mockResolvedValue([{ id: "a-1", employee: { userId: "u-1" } }])

    await remindNotCheckedOut(NOW)

    expect(db.attendance.findMany.mock.calls[0][0].where).toEqual({
      date: TODAY,
      checkIn: { not: null },
      checkOut: null,
    })
    expect(written()).toEqual([
      expect.objectContaining({
        userId: "u-1",
        entity: "ATTENDANCE",
        entityId: "a-1",
        title: "You have not checked out yet",
        meta: "Check out before 10:05 PM, or the app will do it for you.",
        dedupeKey: "checkout-today:a-1",
      }),
    ])
  })
})

describe("remindWaitingTwoDays", () => {
  it("reminds approvers about requests open for 2 days", async () => {
    db.notification.findMany.mockResolvedValue([
      { userId: "u-hr", entity: "LEAVE_REQUEST", entityId: "lr-1", title: "Casual leave requested", meta: "Rahim", href: "/leave" },
    ])

    await remindWaitingTwoDays(NOW)

    const where = db.notification.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      tab: "IMPORTANT",
      closedAt: null,
      eventId: { not: null },
      createdAt: { lte: new Date("2026-11-08T06:00:00.000Z") },
    })
    expect(where.kind.in).toContain("leave.requested")
    expect(written()).toEqual([
      expect.objectContaining({
        userId: "u-hr",
        entity: "LEAVE_REQUEST",
        entityId: "lr-1",
        title: "Still waiting for your answer",
        meta: "Casual leave requested",
        href: "/leave",
        dedupeKey: "waiting-2d:LEAVE_REQUEST:lr-1:u-hr",
      }),
    ])
  })
})

describe("remindAssetsNotAccepted", () => {
  it("reminds an employee who has not accepted an asset after a day", async () => {
    db.assetAssignment.findMany.mockResolvedValue([
      { id: "as-1", assetId: "asset-1", asset: { name: "Dell laptop", assetTag: "IT-0001" }, employee: { userId: "u-1" } },
    ])

    await remindAssetsNotAccepted(NOW)

    expect(db.assetAssignment.findMany.mock.calls[0][0].where).toEqual({
      acknowledgedAt: null,
      returnedAt: null,
      assignedAt: { lte: new Date("2026-11-09T06:00:00.000Z") },
    })
    expect(written()).toEqual([
      expect.objectContaining({
        entity: "ASSET",
        entityId: "asset-1",
        title: "Please accept your asset",
        meta: "IT-0001 · Dell laptop",
        href: "/assets",
        dedupeKey: "asset-accept:as-1",
      }),
    ])
  })
})

describe("remindLeaveTomorrow", () => {
  it("tells the manager the day before someone's leave starts", async () => {
    db.leaveRequest.findMany.mockResolvedValue([
      {
        id: "lr-1",
        startDate: new Date("2026-11-11T00:00:00.000Z"),
        endDate: new Date("2026-11-12T00:00:00.000Z"),
        employee: { fullName: "Rahim Uddin", reportingManager: { userId: "u-mgr" } },
      },
      // No manager: nobody to tell.
      {
        id: "lr-2",
        startDate: new Date("2026-11-11T00:00:00.000Z"),
        endDate: new Date("2026-11-11T00:00:00.000Z"),
        employee: { fullName: "Karim", reportingManager: null },
      },
    ])

    await remindLeaveTomorrow(NOW)

    expect(db.leaveRequest.findMany.mock.calls[0][0].where).toEqual({
      status: "APPROVED",
      startDate: new Date("2026-11-11T00:00:00.000Z"),
    })
    expect(written()).toEqual([
      expect.objectContaining({
        userId: "u-mgr",
        entity: "LEAVE_REQUEST",
        entityId: "lr-1",
        title: "Rahim Uddin starts leave tomorrow",
        href: "/leave",
        dedupeKey: "leave-tomorrow:lr-1",
      }),
    ])
  })
})

describe("inactive users", () => {
  it("never get a reminder", async () => {
    db.user.findMany.mockResolvedValue([])
    db.attendance.findMany.mockResolvedValue([{ id: "a-1", employee: { userId: "u-gone" } }])
    await expect(remindNotCheckedOut(NOW)).resolves.toBe(0)
    expect(db.notification.createMany).not.toHaveBeenCalled()
  })
})
