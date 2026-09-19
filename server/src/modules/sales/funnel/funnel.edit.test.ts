import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env", () => ({ env: { APP_TIMEZONE: "Asia/Dhaka" } }))

vi.mock("../../../config/prisma", () => {
  const tx = {
    opportunity: { findFirst: vi.fn(), update: vi.fn() },
    funnelMeeting: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
    employee: { findUnique: vi.fn() },
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
import { editFunnelCell, MEETING_NOT_OPEN } from "./funnel.edit"

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const tx = (prisma as unknown as { __tx: Record<string, Record<string, unknown>> }).__tx

const USER = {
  sub: "user-1",
  role: "EMPLOYEE",
  email: "rahim@example.com",
  mustChangePassword: false,
  salesRole: "SALES_USER",
} as never

const DEAL = {
  id: "opp-1",
  serial: "BS-OPP-00001",
  salesAccountId: "acc-1",
  ownerEmployeeId: "emp-1",
  useCase: "Old use case",
  offeredOn: new Date("2026-09-05T00:00:00.000Z"),
  expectedCloseDate: new Date("2026-09-30T00:00:00.000Z"),
  amount: "100.00",
  nextStep: null,
  lostToPartner: null,
  lostToAmount: null,
  lostToProduct: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } })
  mocked(tx.user.findUnique).mockResolvedValue({ employee: { id: "emp-1" } })
  mocked(tx.opportunity.findFirst).mockResolvedValue(DEAL)
  mocked(tx.opportunity.update).mockResolvedValue({})
  mocked(tx.auditLog.create).mockResolvedValue({})
  mocked(tx.event.create).mockResolvedValue({})
  mocked(tx.employee.findUnique).mockResolvedValue({ reportingManagerId: null })
})

const edit = (field: string, value: string | null, funnelMeetingId?: string) =>
  editFunnelCell({ opportunityId: "opp-1", edit: { field, value } as never, funnelMeetingId }, USER)

describe("editing writes to the real deal", () => {
  it("updates the opportunity itself, not a funnel copy", async () => {
    await edit("useCase", "Campus core switching")
    const args = mocked(tx.opportunity.update).mock.calls[0][0]
    expect(args.where).toEqual({ id: "opp-1" })
    expect(args.data.useCase).toBe("Campus core switching")
  })

  it("touches lastActivityAt, so the changed-last-week filter can see it", async () => {
    await edit("useCase", "Campus core switching")
    expect(mocked(tx.opportunity.update).mock.calls[0][0].data.lastActivityAt).toBeInstanceOf(Date)
  })

  it("stores a date-only value at UTC midnight", async () => {
    await edit("expectedCloseDate", "2026-10-15")
    const args = mocked(tx.opportunity.update).mock.calls[0][0]
    expect(args.data.expectedCloseDate.toISOString()).toBe("2026-10-15T00:00:00.000Z")
  })

  it("turns a cleared cell into null, never an empty string", async () => {
    // A blank that no filter can find is worse than no value at all.
    await edit("useCase", "")
    expect(mocked(tx.opportunity.update).mock.calls[0][0].data.useCase).toBeNull()
  })

  it("refuses a deal the caller cannot reach", async () => {
    mocked(tx.opportunity.findFirst).mockResolvedValue(null)
    await expect(edit("useCase", "Anything")).rejects.toMatchObject({ statusCode: 404 })
    expect(tx.opportunity.update).not.toHaveBeenCalled()
  })
})

describe("the audit trail", () => {
  it("records what the field was and what it became", async () => {
    await edit("useCase", "Campus core switching")
    const entry = mocked(tx.auditLog.create).mock.calls[0][0].data
    expect(entry.entity).toBe("OPPORTUNITY")
    expect(entry.before).toEqual({ useCase: "Old use case" })
    expect(entry.after).toEqual({ useCase: "Campus core switching" })
  })

  it("writes closing dates as ISO strings, so the slip reader can compare them", async () => {
    // funnel.service reads these back to decide whether a date was pushed
    // later. If the shape drifts, the red mark silently stops working.
    await edit("expectedCloseDate", "2026-10-15")
    const entry = mocked(tx.auditLog.create).mock.calls[0][0].data
    expect(entry.before).toEqual({ expectedCloseDate: "2026-09-30T00:00:00.000Z" })
    expect(entry.after).toEqual({ expectedCloseDate: "2026-10-15T00:00:00.000Z" })
  })

  it("carries no meeting note for an edit made outside a meeting", async () => {
    await edit("useCase", "Campus core switching")
    expect(mocked(tx.auditLog.create).mock.calls[0][0].data.note).toBeNull()
  })
})

describe("an edit made inside a meeting", () => {
  beforeEach(() => {
    mocked(tx.funnelMeeting.findUnique).mockResolvedValue({
      id: "fm-1",
      status: "SCHEDULED",
      heldOn: new Date("2026-09-19T00:00:00.000Z"),
    })
  })

  it("names the meeting in the audit note", async () => {
    await edit("amount", "250.00", "fm-1")
    expect(mocked(tx.auditLog.create).mock.calls[0][0].data.note).toBe(
      "Changed in the funnel meeting of 2026-09-19"
    )
  })

  it("words the timeline entry as coming from the meeting", async () => {
    await edit("amount", "250.00", "fm-1")
    expect(mocked(tx.event.create).mock.calls[0][0].data.title).toContain(
      "changed in the funnel meeting"
    )
  })

  it("is refused when that meeting is already completed", async () => {
    // Attributing a change to a meeting that has finished is a false record.
    mocked(tx.funnelMeeting.findUnique).mockResolvedValue({
      id: "fm-1",
      status: "COMPLETED",
      heldOn: new Date("2026-09-19T00:00:00.000Z"),
    })
    await expect(edit("amount", "250.00", "fm-1")).rejects.toMatchObject({
      statusCode: 409,
      message: MEETING_NOT_OPEN,
    })
    expect(tx.opportunity.update).not.toHaveBeenCalled()
  })

  it("is refused when the meeting does not exist at all", async () => {
    mocked(tx.funnelMeeting.findUnique).mockResolvedValue(null)
    await expect(edit("amount", "250.00", "fm-9")).rejects.toMatchObject({ statusCode: 409 })
  })
})
