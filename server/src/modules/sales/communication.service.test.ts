import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesAccount: { findFirst: vi.fn() },
    salesContact: { findFirst: vi.fn() },
    salesCommunication: { create: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    event: { findMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { getAccountTimeline, logCommunication } from "./communication.service"

const USER = {
  sub: "user-2",
  role: "EMPLOYEE",
  email: "rahim@demo.com",
  mustChangePassword: false,
  salesRole: "SALES_USER",
} as any

const CALL = {
  channel: "CALL" as const,
  occurredAt: "2026-09-04T10:00:00Z",
  summary: "Chased the RFQ",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({
    id: "sa-1",
    ownerEmployeeId: "emp-9",
  } as any)
  vi.mocked(prisma.salesCommunication.create).mockResolvedValue({
    id: "cm-1",
    salesAccountId: "sa-1",
    contactId: null,
    channel: "CALL",
    occurredAt: new Date(CALL.occurredAt),
    summary: CALL.summary,
    detail: null,
    employeeId: "emp-2",
    createdAt: new Date("2026-09-07"),
  } as any)
})

describe("logCommunication", () => {
  it("records a call with the author frozen at the time of writing", async () => {
    await logCommunication("sa-1", CALL, USER)

    // employeeId, not a join to the account's current owner: who made the
    // call does not change when the account changes hands.
    expect(prisma.salesCommunication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          salesAccountId: "sa-1",
          employeeId: "emp-2",
          channel: "CALL",
        }),
      })
    )
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SALES_COMMUNICATION",
          entityId: "cm-1",
          action: "CREATE",
          changedBy: "user-2",
        }),
      })
    )
  })

  // Always a typo, and it would sit at the top of the Timeline forever.
  it("refuses an occurredAt in the future", async () => {
    await expect(
      logCommunication("sa-1", { ...CALL, occurredAt: "2099-01-01T00:00:00Z" }, USER)
    ).rejects.toThrow(/future/)

    expect(prisma.salesCommunication.create).not.toHaveBeenCalled()
  })

  it("refuses a communication on an account the caller cannot see", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(logCommunication("sa-9", CALL, USER)).rejects.toThrow(AppError)

    expect(prisma.salesCommunication.create).not.toHaveBeenCalled()
  })

  // Super Admin and HR Admin are seeded with no Employee row. Without this the
  // null reaches a NOT NULL column and comes back as a 500.
  it("refuses a caller who has no employee record", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: null } as any)
    // A Sales Admin, so the scope does not refuse them first.
    const admin = { ...USER, salesRole: "SALES_ADMIN" }

    await expect(logCommunication("sa-1", CALL, admin)).rejects.toThrow(/employee/i)

    expect(prisma.salesCommunication.create).not.toHaveBeenCalled()
  })

  it("refuses a contact that belongs to a different account", async () => {
    vi.mocked(prisma.salesContact.findFirst).mockResolvedValue(null)

    await expect(
      logCommunication(
        "sa-1",
        { ...CALL, contactId: "11111111-1111-4111-8111-111111111111" },
        USER
      )
    ).rejects.toThrow(/contact/i)

    expect(prisma.salesCommunication.create).not.toHaveBeenCalled()
  })
})

describe("getAccountTimeline", () => {
  it("merges communications and events into one timeline, newest first", async () => {
    vi.mocked(prisma.salesCommunication.findMany).mockResolvedValue([
      {
        id: "cm-1",
        channel: "CALL",
        occurredAt: new Date("2026-09-03"),
        summary: "Chased the RFQ",
        detail: null,
        employeeId: "emp-2",
        employee: { fullName: "Rahim" },
        contact: null,
      },
    ] as any)
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      {
        id: "ev-1",
        type: "sales.account.created",
        createdAt: new Date("2026-09-01"),
        title: "Rising Group added to the Sales Hub",
        meta: "Owner: Karim",
      },
      {
        id: "ev-2",
        type: "sales.contact.verified",
        createdAt: new Date("2026-09-05"),
        title: "Mr Rahman verified",
        meta: null,
      },
    ] as any)

    const { items } = await getAccountTimeline("sa-1", USER)

    expect(items.map((i) => i.at)).toEqual([
      "2026-09-05T00:00:00.000Z",
      "2026-09-03T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    ])
    expect(items.map((i) => i.kind)).toEqual(["event", "communication", "event"])
  })

  it("names the author of a communication and labels its channel", async () => {
    vi.mocked(prisma.salesCommunication.findMany).mockResolvedValue([
      {
        id: "cm-1",
        channel: "WHATSAPP",
        occurredAt: new Date("2026-09-03"),
        summary: "Sent the revised quote",
        detail: null,
        employeeId: "emp-2",
        employee: { fullName: "Rahim" },
        contact: { name: "Mr Rahman" },
      },
    ] as any)
    vi.mocked(prisma.event.findMany).mockResolvedValue([] as any)

    const { items } = await getAccountTimeline("sa-1", USER)

    expect(items[0]).toMatchObject({
      kind: "communication",
      title: "Sent the revised quote",
      meta: "WhatsApp · Mr Rahman",
      by: "Rahim",
    })
  })

  it("reads only the events keyed to this account", async () => {
    vi.mocked(prisma.salesCommunication.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.event.findMany).mockResolvedValue([] as any)

    await getAccountTimeline("sa-1", USER)

    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entity: "SALES_ACCOUNT", entityId: "sa-1" },
      })
    )
  })

  it("refuses a timeline for an account the caller cannot see", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(getAccountTimeline("sa-9", USER)).rejects.toThrow(AppError)

    expect(prisma.salesCommunication.findMany).not.toHaveBeenCalled()
  })
})
