import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(),
    funnelMeeting: { findUnique: vi.fn() },
    opportunity: { findUnique: vi.fn() },
    salesComment: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    user: { findUnique: vi.fn() },
  }
  return {
    default: {
      $transaction: vi.fn(async (fn: (c: unknown) => unknown) => fn(tx)),
      __tx: tx,
      user: { findUnique: vi.fn() },
    },
  }
})

import prisma from "../../../config/prisma"
import { MEETING_CLOSED } from "./funnel.meeting"
import { addManagementNote, NOTE_DEAL_MISSING, NOTE_NOT_QUOTED } from "./funnel.notes"

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

const BODY = { opportunityId: "opp-1", body: "Stuck on the CFO. Chase before Thursday." }

beforeEach(() => {
  vi.clearAllMocks()
  mocked(tx.$queryRaw).mockResolvedValue([])
  mocked(tx.funnelMeeting.findUnique).mockResolvedValue({
    id: "fm-1",
    status: "SCHEDULED",
    weekStart: new Date("2026-09-13T00:00:00.000Z"),
    ranByEmployeeId: "emp-admin",
    note: null,
  })
  mocked(tx.opportunity.findUnique).mockResolvedValue({
    id: "opp-1",
    offeredOn: new Date("2026-09-05T00:00:00.000Z"),
  })
  mocked(tx.user.findUnique).mockResolvedValue({ employee: { id: "emp-admin" } })
  mocked(tx.salesComment.create).mockResolvedValue({
    id: "c-1",
    createdAt: new Date("2026-09-19T09:00:00.000Z"),
  })
  mocked(tx.auditLog.create).mockResolvedValue({})
})

describe("a management note at a funnel meeting", () => {
  it("is refused to a Sales User", async () => {
    await expect(addManagementNote("fm-1", BODY, USER)).rejects.toMatchObject({ statusCode: 403 })
    expect(tx.salesComment.create).not.toHaveBeenCalled()
  })

  it("lands as a management note carrying the meeting and the author's employee row", async () => {
    const result = await addManagementNote("fm-1", BODY, ADMIN)
    expect(result).toEqual({ id: "c-1", createdAt: "2026-09-19T09:00:00.000Z" })

    const data = mocked(tx.salesComment.create).mock.calls[0][0].data
    expect(data).toMatchObject({
      entity: "OPPORTUNITY",
      entityId: "opp-1",
      kind: "MANAGEMENT_NOTE",
      authorUserId: "user-2",
      // Without it the remark is signed with the sign-in address.
      authorEmployeeId: "emp-admin",
      funnelMeetingId: "fm-1",
    })
  })

  it("writes an audit row for its creation, like every other comment", async () => {
    await addManagementNote("fm-1", BODY, ADMIN)
    const entry = mocked(tx.auditLog.create).mock.calls[0][0].data
    expect(entry).toMatchObject({ entity: "SALES_COMMENT", entityId: "c-1", action: "CREATE" })
    expect(entry.after).toMatchObject({ kind: "MANAGEMENT_NOTE", funnelMeetingId: "fm-1" })
  })

  it("is refused once the meeting is completed", async () => {
    mocked(tx.funnelMeeting.findUnique).mockResolvedValue({ id: "fm-1", status: "COMPLETED" })
    await expect(addManagementNote("fm-1", BODY, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
      message: MEETING_CLOSED,
    })
    expect(tx.salesComment.create).not.toHaveBeenCalled()
  })

  it("takes the meeting's row lock before it checks the status", async () => {
    await addManagementNote("fm-1", BODY, ADMIN)
    expect(mocked(tx.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(
      mocked(tx.funnelMeeting.findUnique).mock.invocationCallOrder[0]
    )
  })

  it("refuses a deal that does not exist", async () => {
    mocked(tx.opportunity.findUnique).mockResolvedValue(null)
    await expect(addManagementNote("fm-1", BODY, ADMIN)).rejects.toMatchObject({
      statusCode: 404,
      message: NOTE_DEAL_MISSING,
    })
  })

  it("refuses a deal that has not been quoted, since it is not in the funnel", async () => {
    mocked(tx.opportunity.findUnique).mockResolvedValue({ id: "opp-1", offeredOn: null })
    await expect(addManagementNote("fm-1", BODY, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
      message: NOTE_NOT_QUOTED,
    })
    expect(tx.salesComment.create).not.toHaveBeenCalled()
  })
})
