import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesAccount: { findFirst: vi.fn() },
    salesContact: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    event: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { addContact, listContacts, setContactStatus, setPrimaryContact } from "./contact.service"

const USER = {
  sub: "user-2",
  role: "EMPLOYEE",
  email: "rahim@demo.com",
  mustChangePassword: false,
  salesRole: "SALES_USER",
} as any

/** What `salesContact.create`/`update` hand back, so `toSummary` has fields. */
const ROW = {
  id: "c-1",
  salesAccountId: "sa-1",
  name: "Mr Rahman",
  designation: "Head of Procurement",
  phone: "01700000000",
  email: null,
  isPrimary: false,
  status: "UNVERIFIED",
  verifiedAt: null,
  note: null,
  createdAt: new Date("2026-09-07"),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma))
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ employee: { id: "emp-2" } } as any)
  // In scope unless a test says otherwise.
  vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue({
    id: "sa-1",
    ownerEmployeeId: "emp-9",
  } as any)
  vi.mocked(prisma.salesContact.create).mockResolvedValue(ROW as any)
  vi.mocked(prisma.salesContact.update).mockResolvedValue(ROW as any)
})

describe("addContact", () => {
  it("creates the contact and audits it", async () => {
    const result = await addContact(
      "sa-1",
      { name: "Mr Rahman", designation: "Head of Procurement", phone: "01700000000" },
      USER
    )

    expect(result).toMatchObject({ id: "c-1", name: "Mr Rahman", isPrimary: false })
    expect(prisma.salesContact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ salesAccountId: "sa-1", createdBy: "user-2" }),
      })
    )
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SALES_CONTACT",
          entityId: "c-1",
          action: "CREATE",
          changedBy: "user-2",
        }),
      })
    )
  })

  // Verification is an act, not a default, and so is being the primary.
  it("does not silently make a new contact primary or verified", async () => {
    await addContact("sa-1", { name: "Mr Rahman" }, USER)

    const data = vi.mocked(prisma.salesContact.create).mock.calls[0][0].data as any
    expect(data.isPrimary).toBeUndefined()
    expect(data.status).toBeUndefined()
  })

  it("refuses to add a contact to an account the caller cannot see", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(addContact("sa-9", { name: "Someone" }, USER)).rejects.toThrow(AppError)

    expect(prisma.salesContact.create).not.toHaveBeenCalled()
  })
})

describe("listContacts", () => {
  it("returns the primary first, then by name", async () => {
    vi.mocked(prisma.salesContact.findMany).mockResolvedValue([ROW] as any)

    const result = await listContacts("sa-1", USER)

    expect(result).toHaveLength(1)
    expect(prisma.salesContact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { salesAccountId: "sa-1" },
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      })
    )
  })

  it("refuses a list for an account the caller cannot see", async () => {
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(listContacts("sa-9", USER)).rejects.toThrow(AppError)

    expect(prisma.salesContact.findMany).not.toHaveBeenCalled()
  })
})

describe("setPrimaryContact", () => {
  it("demotes the previous primary before promoting the new one", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue({
      ...ROW,
      id: "c-2",
      isPrimary: false,
    } as any)

    await setPrimaryContact("c-2", USER)

    // Order matters. A promote-then-demote leaves two rows claiming primary,
    // and anything reading in between sees whichever the sort returned.
    const demote = vi.mocked(prisma.salesContact.updateMany).mock.invocationCallOrder[0]
    const promote = vi.mocked(prisma.salesContact.update).mock.invocationCallOrder[0]
    expect(demote).toBeLessThan(promote)
    expect(prisma.salesContact.updateMany).toHaveBeenCalledWith({
      where: { salesAccountId: "sa-1", isPrimary: true },
      data: { isPrimary: false },
    })
    expect(prisma.salesContact.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c-2" }, data: { isPrimary: true } })
    )
  })

  it("writes nothing when the contact is already the primary", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue({
      ...ROW,
      isPrimary: true,
    } as any)

    await setPrimaryContact("c-1", USER)

    expect(prisma.salesContact.updateMany).not.toHaveBeenCalled()
    expect(prisma.salesContact.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("refuses a contact on an account the caller cannot see", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue({
      ...ROW,
      salesAccountId: "sa-9",
    } as any)
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(setPrimaryContact("c-1", USER)).rejects.toThrow(AppError)

    expect(prisma.salesContact.updateMany).not.toHaveBeenCalled()
    expect(prisma.salesContact.update).not.toHaveBeenCalled()
  })

  it("404s a contact that does not exist", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue(null)

    await expect(setPrimaryContact("c-nope", USER)).rejects.toThrow(/contact/i)
  })
})

describe("setContactStatus", () => {
  it("stamps verifiedAt and verifiedBy when a contact is marked VERIFIED", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue(ROW as any)

    await setContactStatus("c-1", { status: "VERIFIED" }, USER)

    expect(prisma.salesContact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-1" },
        data: expect.objectContaining({
          status: "VERIFIED",
          verifiedBy: "user-2",
          verifiedAt: expect.any(Date),
        }),
      })
    )
  })

  it("puts a verification on the account timeline", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue(ROW as any)

    await setContactStatus("c-1", { status: "VERIFIED" }, USER)

    expect(prisma.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "sales.contact.verified",
          entity: "SALES_ACCOUNT",
          entityId: "sa-1",
        }),
      })
    )
  })

  // A stale verification is worse than none: it says somebody reached this
  // person when the last attempt proved otherwise.
  it("clears verifiedAt when a verified contact is later marked INVALID", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue({
      ...ROW,
      status: "VERIFIED",
      verifiedAt: new Date("2026-08-01"),
    } as any)

    await setContactStatus("c-1", { status: "INVALID" }, USER)

    expect(prisma.salesContact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "INVALID",
          verifiedAt: null,
          verifiedBy: null,
        }),
      })
    )
    expect(prisma.event.create).not.toHaveBeenCalled()
  })

  it("audits a status change with before and after", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue(ROW as any)

    await setContactStatus("c-1", { status: "UNREACHABLE", note: "Rang out twice" }, USER)

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entity: "SALES_CONTACT",
          entityId: "c-1",
          action: "UPDATE",
          changedBy: "user-2",
          before: { status: "UNVERIFIED" },
          after: { status: "UNREACHABLE" },
          note: "Rang out twice",
        }),
      })
    )
  })

  it("writes nothing when the status is already what was asked for", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue(ROW as any)

    await setContactStatus("c-1", { status: "UNVERIFIED" }, USER)

    expect(prisma.salesContact.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("refuses a contact on an account the caller cannot see", async () => {
    vi.mocked(prisma.salesContact.findUnique).mockResolvedValue(ROW as any)
    vi.mocked(prisma.salesAccount.findFirst).mockResolvedValue(null)

    await expect(setContactStatus("c-1", { status: "VERIFIED" }, USER)).rejects.toThrow(AppError)

    expect(prisma.salesContact.update).not.toHaveBeenCalled()
  })
})
