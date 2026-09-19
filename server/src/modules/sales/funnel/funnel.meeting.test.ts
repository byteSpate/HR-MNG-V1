import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => {
  const tx = {
    funnelMeeting: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    funnelMeetingAttendee: { deleteMany: vi.fn(), createMany: vi.fn() },
    funnelMeetingReview: { upsert: vi.fn(), deleteMany: vi.fn() },
    salesTask: { create: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
    employee: { findUnique: vi.fn(), findFirst: vi.fn() },
    opportunity: { findUnique: vi.fn() },
  }
  return {
    default: {
      $transaction: vi.fn(async (fn: (c: unknown) => unknown) => fn(tx)),
      __tx: tx,
      funnelMeeting: { findUnique: vi.fn(), update: vi.fn() },
      employee: { findUnique: vi.fn(), findFirst: vi.fn() },
      opportunity: { findUnique: vi.fn() },
      salesTask: { findMany: vi.fn() },
      user: { findUnique: vi.fn() },
    },
  }
})

import prisma from "../../../config/prisma"
import { ACTIONS_ADMIN_ONLY, ASSIGNEE_NOT_SALES, createFunnelAction } from "./funnel.actions"
import {
  ADMIN_ONLY,
  MEETING_CLOSED,
  openFunnelMeeting,
  setMeetingStatus,
  setPersonReviewed,
} from "./funnel.meeting"

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const tx = (prisma as unknown as { __tx: Record<string, Record<string, unknown>> }).__tx

const USER = {
  sub: "user-1",
  role: "EMPLOYEE",
  email: "rahim@example.com",
  mustChangePassword: false,
  salesRole: "SALES_USER",
} as never

const ADMIN = {
  sub: "user-2",
  role: "EMPLOYEE",
  email: "admin@example.com",
  mustChangePassword: false,
  salesRole: "SALES_ADMIN",
} as never

const DETAIL = {
  id: "fm-1",
  weekStart: new Date("2026-09-13T00:00:00.000Z"),
  heldOn: new Date("2026-09-19T00:00:00.000Z"),
  status: "SCHEDULED",
  ranByEmployeeId: "emp-admin",
  ranBy: { fullName: "Admin Person" },
  note: null,
  attendees: [],
  reviews: [],
  _count: { tasks: 0 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-admin" } })
  mocked(prisma.funnelMeeting.findUnique).mockResolvedValue(null)
  mocked(tx.funnelMeeting.create).mockResolvedValue(DETAIL)
  mocked(tx.funnelMeeting.update).mockResolvedValue(DETAIL)
  mocked(tx.funnelMeeting.findUniqueOrThrow).mockResolvedValue(DETAIL)
  mocked(tx.auditLog.create).mockResolvedValue({})
  mocked(tx.event.create).mockResolvedValue({})
  mocked(tx.employee.findUnique).mockResolvedValue({ reportingManagerId: null })
})

describe("who may run a meeting", () => {
  it("refuses a Sales User", async () => {
    await expect(openFunnelMeeting({}, USER)).rejects.toMatchObject({
      statusCode: 403,
      message: ADMIN_ONLY,
    })
  })

  it("refuses a Sales User marking somebody reviewed", async () => {
    await expect(
      setPersonReviewed("fm-1", { employeeId: "emp-1", reviewed: true }, USER)
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe("opening the review", () => {
  it("defaults to the week that just finished", async () => {
    // Held Saturday 19 Sep, so it reviews the week whose Sunday is 13 Sep.
    await openFunnelMeeting({}, ADMIN, new Date("2026-09-19T09:00:00.000Z"))
    const data = mocked(tx.funnelMeeting.create).mock.calls[0][0].data
    expect(data.weekStart.toISOString()).toBe("2026-09-13T00:00:00.000Z")
  })

  it("hands back the meeting already open instead of refusing", async () => {
    // weekStart is unique. Two admins pressing the same button is not an
    // error, it is two people arriving at the same meeting.
    mocked(prisma.funnelMeeting.findUnique).mockResolvedValue(DETAIL)
    const result = await openFunnelMeeting({}, ADMIN, new Date("2026-09-19T09:00:00.000Z"))
    expect(result.id).toBe("fm-1")
    expect(tx.funnelMeeting.create).not.toHaveBeenCalled()
  })

  it("records who ran it and writes an audit row", async () => {
    await openFunnelMeeting({}, ADMIN, new Date("2026-09-19T09:00:00.000Z"))
    const data = mocked(tx.funnelMeeting.create).mock.calls[0][0].data
    expect(data.ranByEmployeeId).toBe("emp-admin")
    expect(tx.auditLog.create).toHaveBeenCalled()
  })
})

describe("a completed meeting takes no new work", () => {
  beforeEach(() => {
    mocked(prisma.funnelMeeting.findUnique).mockResolvedValue({
      id: "fm-1",
      status: "COMPLETED",
      weekStart: new Date("2026-09-13T00:00:00.000Z"),
      ranByEmployeeId: "emp-admin",
    })
  })

  it("refuses a new reviewed tick", async () => {
    await expect(
      setPersonReviewed("fm-1", { employeeId: "emp-1", reviewed: true }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, message: MEETING_CLOSED })
  })

  it("refuses a new action item", async () => {
    await expect(
      createFunnelAction("fm-1", { assignedToEmployeeId: "emp-1", title: "Chase it" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 409, message: MEETING_CLOSED })
  })

  it("can still be reopened, because that is ordinary and not an exception", async () => {
    const result = await setMeetingStatus("fm-1", "SCHEDULED", ADMIN)
    expect(result.id).toBe("fm-1")
    expect(mocked(tx.funnelMeeting.update).mock.calls[0][0].data.status).toBe("SCHEDULED")
  })
})

describe("reviewed is not attendance", () => {
  beforeEach(() => {
    mocked(prisma.funnelMeeting.findUnique).mockResolvedValue({
      id: "fm-1",
      status: "SCHEDULED",
      weekStart: new Date("2026-09-13T00:00:00.000Z"),
      ranByEmployeeId: "emp-admin",
    })
  })

  it("marks somebody reviewed without touching the attendee list", async () => {
    // Somebody can be away and their deals still walked (§27.3).
    await setPersonReviewed("fm-1", { employeeId: "emp-1", reviewed: true }, ADMIN)
    expect(tx.funnelMeetingReview.upsert).toHaveBeenCalled()
    expect(tx.funnelMeetingAttendee.deleteMany).not.toHaveBeenCalled()
    expect(tx.funnelMeetingAttendee.createMany).not.toHaveBeenCalled()
  })

  it("takes the tick back off for somebody ticked by mistake", async () => {
    await setPersonReviewed("fm-1", { employeeId: "emp-1", reviewed: false }, ADMIN)
    expect(tx.funnelMeetingReview.deleteMany).toHaveBeenCalledWith({
      where: { funnelMeetingId: "fm-1", employeeId: "emp-1" },
    })
    expect(tx.funnelMeetingReview.upsert).not.toHaveBeenCalled()
  })
})

describe("action items: the one behaviour change in phase 6", () => {
  beforeEach(() => {
    mocked(prisma.funnelMeeting.findUnique).mockResolvedValue({ id: "fm-1", status: "SCHEDULED" })
    mocked(prisma.employee.findFirst).mockResolvedValue({ id: "emp-1" })
    mocked(tx.salesTask.create).mockResolvedValue({
      id: "task-1",
      origin: "FUNNEL_MEETING",
      salesAccountId: null,
      opportunityId: null,
      meetingId: null,
      title: "Chase the CFO",
      detail: null,
      dueOn: new Date("2026-09-26T00:00:00.000Z"),
      priority: "NORMAL",
      status: "PENDING",
      assignedToEmployeeId: "emp-1",
      assignedByEmployeeId: "emp-admin",
      assignedTo: { fullName: "Rahim Uddin" },
      outcome: null,
      cancelReason: null,
      completedAt: null,
      createdAt: new Date("2026-09-19T09:00:00.000Z"),
      updatedAt: new Date("2026-09-19T09:00:00.000Z"),
    })
  })

  it("is refused to a Sales User", async () => {
    await expect(
      createFunnelAction("fm-1", { assignedToEmployeeId: "emp-1", title: "Chase it" }, USER)
    ).rejects.toMatchObject({ statusCode: 403, message: ACTIONS_ADMIN_ONLY })
  })

  it("records a giver, which no other task in the system has", async () => {
    await createFunnelAction(
      "fm-1",
      { assignedToEmployeeId: "emp-1", title: "Chase the CFO" },
      ADMIN,
      new Date("2026-09-19T09:00:00.000Z")
    )
    const data = mocked(tx.salesTask.create).mock.calls[0][0].data
    expect(data.origin).toBe("FUNNEL_MEETING")
    expect(data.assignedToEmployeeId).toBe("emp-1")
    expect(data.assignedByEmployeeId).toBe("emp-admin")
    expect(data.funnelMeetingId).toBe("fm-1")
  })

  it("falls due the next Saturday when no date is given", async () => {
    // Given at Saturday's review, due by the next one, not that evening.
    await createFunnelAction(
      "fm-1",
      { assignedToEmployeeId: "emp-1", title: "Chase the CFO" },
      ADMIN,
      new Date("2026-09-19T09:00:00.000Z")
    )
    const data = mocked(tx.salesTask.create).mock.calls[0][0].data
    expect(data.dueOn.toISOString()).toBe("2026-09-26T00:00:00.000Z")
  })

  it("refuses to hand work to somebody outside the Sales Hub", async () => {
    // A task the assignee cannot open is a task nobody will ever see.
    mocked(prisma.employee.findFirst).mockResolvedValue(null)
    await expect(
      createFunnelAction("fm-1", { assignedToEmployeeId: "emp-9", title: "Chase it" }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: ASSIGNEE_NOT_SALES })
  })

  it("writes only the task and its audit row, and sends no email", async () => {
    // It reaches people through the existing 00:01 daily email (§27.13);
    // nothing in this module imports the mailer at all.
    await createFunnelAction(
      "fm-1",
      { assignedToEmployeeId: "emp-1", title: "Chase the CFO" },
      ADMIN,
      new Date("2026-09-19T09:00:00.000Z")
    )
    expect(tx.salesTask.create).toHaveBeenCalledTimes(1)
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1)
  })
})
