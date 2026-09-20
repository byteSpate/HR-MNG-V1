import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(),
    salesAccount: { findUnique: vi.fn() },
    funnelMeeting: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    funnelMeetingAttendee: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    funnelMeetingReview: { upsert: vi.fn(), deleteMany: vi.fn() },
    salesTask: { create: vi.fn(), findMany: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
    employee: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
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
import { Prisma } from "../../../generated/prisma/client"
import {
  ACTION_ACCOUNT_MISSING,
  ACTIONS_ADMIN_ONLY,
  ASSIGNEE_NOT_SALES,
  createFunnelAction,
} from "./funnel.actions"
import {
  ADMIN_ONLY,
  MEETING_CLOSED,
  openFunnelMeeting,
  setMeetingAttendees,
  setMeetingNote,
  setMeetingStatus,
  setPersonReviewed,
  UNKNOWN_PEOPLE,
  UNKNOWN_PERSON,
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

/** What the row lock reads back. Every write takes it, then checks the status. */
const meetingIs = (status: "SCHEDULED" | "COMPLETED", note: string | null = null) =>
  mocked(tx.funnelMeeting.findUnique).mockResolvedValue({
    id: "fm-1",
    status,
    weekStart: new Date("2026-09-13T00:00:00.000Z"),
    ranByEmployeeId: "emp-admin",
    note,
  })

const auditCalls = () => mocked(tx.auditLog.create).mock.calls.map((c) => c[0].data)

beforeEach(() => {
  vi.clearAllMocks()
  meetingIs("SCHEDULED")
  mocked(tx.$queryRaw).mockResolvedValue([])
  mocked(tx.employee.findMany).mockResolvedValue([{ id: "emp-1" }, { id: "emp-2" }])
  mocked(tx.funnelMeetingAttendee.findMany).mockResolvedValue([])
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
  beforeEach(() => meetingIs("COMPLETED"))

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
    mocked(tx.employee.findFirst).mockResolvedValue({ id: "emp-1" })
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
    mocked(tx.employee.findFirst).mockResolvedValue(null)
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

describe("action items: what they may point at", () => {
  beforeEach(() => {
    mocked(tx.employee.findFirst).mockResolvedValue({ id: "emp-1" })
  })

  it("refuses an account that does not exist instead of failing on a foreign key", async () => {
    mocked(tx.salesAccount.findUnique).mockResolvedValue(null)
    await expect(
      createFunnelAction(
        "fm-1",
        { assignedToEmployeeId: "emp-1", title: "Chase it", salesAccountId: "acc-9" },
        ADMIN
      )
    ).rejects.toMatchObject({ statusCode: 400, message: ACTION_ACCOUNT_MISSING })
    expect(tx.salesTask.create).not.toHaveBeenCalled()
  })

  it("locks the meeting before it reads its status, so a completion cannot slip between", async () => {
    mocked(tx.salesAccount.findUnique).mockResolvedValue(null)
    await createFunnelAction(
      "fm-1",
      { assignedToEmployeeId: "emp-1", title: "Chase it", salesAccountId: "acc-9" },
      ADMIN
    ).catch(() => undefined)
    expect(tx.$queryRaw).toHaveBeenCalled()
    expect(mocked(tx.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      mocked(tx.funnelMeeting.findUnique).mock.invocationCallOrder[0]
    )
  })
})

describe("opening the review: races and dates", () => {
  it("lands the second of two simultaneous opens in the first one's meeting", async () => {
    // Both pass the "does it exist" check; the unique week key refuses one.
    mocked(prisma.funnelMeeting.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(DETAIL)
    mocked(tx.funnelMeeting.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    )
    const result = await openFunnelMeeting({}, ADMIN, new Date("2026-09-19T09:00:00.000Z"))
    expect(result.id).toBe("fm-1")
  })

  it("does not swallow a failure that is not the unique key", async () => {
    mocked(tx.funnelMeeting.create).mockRejectedValue(new Error("connection lost"))
    await expect(openFunnelMeeting({}, ADMIN, new Date("2026-09-19T09:00:00.000Z"))).rejects.toThrow(
      "connection lost"
    )
  })

  it("reads the office's date: 03:00 Saturday in Dhaka reviews the week just finished", async () => {
    // 2026-09-11T21:00Z is Saturday 12 Sep in Dhaka but still Friday in UTC,
    // which would have named the week before.
    await openFunnelMeeting({}, ADMIN, new Date("2026-09-11T21:00:00.000Z"))
    const data = mocked(tx.funnelMeeting.create).mock.calls[0][0].data
    expect(data.weekStart.toISOString()).toBe("2026-09-06T00:00:00.000Z")
    expect(data.heldOn.toISOString()).toBe("2026-09-12T00:00:00.000Z")
  })
})

describe("who was in the room", () => {
  it("records the change, before and after", async () => {
    mocked(tx.funnelMeetingAttendee.findMany).mockResolvedValue([{ employeeId: "emp-2" }])
    await setMeetingAttendees("fm-1", { employeeIds: ["emp-1", "emp-2"] }, ADMIN)
    expect(auditCalls()).toHaveLength(1)
    expect(auditCalls()[0]).toMatchObject({
      entity: "FUNNEL_MEETING",
      entityId: "fm-1",
      before: { attendees: ["emp-2"] },
      after: { attendees: ["emp-1", "emp-2"] },
    })
  })

  it("counts a person once however many times they are sent", async () => {
    await setMeetingAttendees("fm-1", { employeeIds: ["emp-1", "emp-1", "emp-2"] }, ADMIN)
    expect(mocked(tx.funnelMeetingAttendee.createMany).mock.calls[0][0].data).toHaveLength(2)
  })

  it("refuses somebody who does not exist rather than failing on a foreign key", async () => {
    mocked(tx.employee.findMany).mockResolvedValue([{ id: "emp-1" }])
    await expect(
      setMeetingAttendees("fm-1", { employeeIds: ["emp-1", "emp-9"] }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 400, message: UNKNOWN_PEOPLE })
    expect(tx.funnelMeetingAttendee.deleteMany).not.toHaveBeenCalled()
  })

  it("is refused once the meeting is completed", async () => {
    meetingIs("COMPLETED")
    await expect(setMeetingAttendees("fm-1", { employeeIds: [] }, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
      message: MEETING_CLOSED,
    })
  })
})

describe("marking somebody reviewed leaves a trail", () => {
  it("audits the tick and the tick coming off", async () => {
    await setPersonReviewed("fm-1", { employeeId: "emp-1", reviewed: true }, ADMIN)
    await setPersonReviewed("fm-1", { employeeId: "emp-1", reviewed: false }, ADMIN)
    expect(auditCalls().map((a) => a.after)).toEqual([
      { employeeId: "emp-1", reviewed: true },
      { employeeId: "emp-1", reviewed: false },
    ])
  })

  it("refuses somebody who does not exist", async () => {
    mocked(tx.employee.findUnique).mockResolvedValue(null)
    await expect(
      setPersonReviewed("fm-1", { employeeId: "emp-9", reviewed: true }, ADMIN)
    ).rejects.toMatchObject({ statusCode: 404, message: UNKNOWN_PERSON })
    expect(tx.funnelMeetingReview.upsert).not.toHaveBeenCalled()
  })
})

describe("the week note", () => {
  it("audits a change, with what it was and what it became", async () => {
    meetingIs("SCHEDULED", "Old note")
    await setMeetingNote("fm-1", { note: "New note" }, ADMIN)
    expect(auditCalls()[0]).toMatchObject({
      before: { note: "Old note" },
      after: { note: "New note" },
    })
  })

  it("writes no audit row for a save that changes nothing", async () => {
    meetingIs("SCHEDULED", "Same note")
    await setMeetingNote("fm-1", { note: "Same note" }, ADMIN)
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("is refused once the meeting is completed", async () => {
    meetingIs("COMPLETED")
    await expect(setMeetingNote("fm-1", { note: "Late" }, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
    })
    expect(tx.funnelMeeting.update).not.toHaveBeenCalled()
  })
})

describe("completing and reopening", () => {
  it("audits and announces a real completion", async () => {
    await setMeetingStatus("fm-1", "COMPLETED", ADMIN)
    expect(auditCalls()[0]).toMatchObject({
      before: { status: "SCHEDULED" },
      after: { status: "COMPLETED" },
    })
    expect(mocked(tx.event.create).mock.calls[0][0].data.type).toBe("sales.funnel.meeting_completed")
  })

  it("audits and announces a real reopening, and says so", async () => {
    meetingIs("COMPLETED")
    await setMeetingStatus("fm-1", "SCHEDULED", ADMIN)
    expect(auditCalls()[0]).toMatchObject({
      before: { status: "COMPLETED" },
      after: { status: "SCHEDULED" },
    })
    expect(mocked(tx.event.create).mock.calls[0][0].data.type).toBe("sales.funnel.meeting_reopened")
  })

  it("does nothing, and says nothing, when the meeting is already there", async () => {
    // A second click, or a second admin. A "reopened" row for a meeting that
    // was never completed would defeat the point of the status being an enum.
    await setMeetingStatus("fm-1", "SCHEDULED", ADMIN)
    meetingIs("COMPLETED")
    await setMeetingStatus("fm-1", "COMPLETED", ADMIN)
    expect(tx.funnelMeeting.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
    expect(tx.event.create).not.toHaveBeenCalled()
  })

  it("takes the row lock before reading the status", async () => {
    await setMeetingStatus("fm-1", "COMPLETED", ADMIN)
    expect(mocked(tx.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      mocked(tx.funnelMeeting.findUnique).mock.invocationCallOrder[0]
    )
  })

  it("answers not found for a meeting that does not exist", async () => {
    mocked(tx.funnelMeeting.findUnique).mockResolvedValue(null)
    await expect(setMeetingStatus("fm-9", "COMPLETED", ADMIN)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it("is refused to a Sales User", async () => {
    await expect(setMeetingStatus("fm-1", "COMPLETED", USER)).rejects.toMatchObject({
      statusCode: 403,
      message: ADMIN_ONLY,
    })
  })
})
