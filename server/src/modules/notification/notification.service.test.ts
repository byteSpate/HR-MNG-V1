import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: { emailDispatch: { findMany: vi.fn() } },
}))

import prisma from "../../config/prisma"
import { listDispatches } from "./notification.service"

const mockedPrisma = prisma as unknown as {
  emailDispatch: { findMany: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedPrisma.emailDispatch.findMany.mockResolvedValue([])
})

describe("listDispatches", () => {
  it("filters to failures as errored-and-never-sent", async () => {
    await listDispatches({ failedOnly: true })

    expect(mockedPrisma.emailDispatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { error: { not: null }, sentAt: null } })
    )
  })

  it("filters by kind", async () => {
    await listDispatches({ kind: "PAYSLIP" })

    expect(mockedPrisma.emailDispatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: "PAYSLIP" } })
    )
  })

  it("returns a nextCursor only when a further page exists", async () => {
    mockedPrisma.emailDispatch.findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, n) => ({
        id: `d${n}`,
        to: "a@b.com",
        kind: "PAYSLIP",
        subject: "s",
        entity: null,
        entityId: null,
        sentAt: new Date(),
        error: null,
        createdAt: new Date(),
      }))
    )

    const result = await listDispatches({ limit: 50 })

    expect(result.items).toHaveLength(50)
    expect(result.nextCursor).toBe("d49")
  })

  it("returns no cursor on the last page", async () => {
    mockedPrisma.emailDispatch.findMany.mockResolvedValue([
      {
        id: "d1",
        to: "a@b.com",
        kind: "PAYSLIP",
        subject: "s",
        entity: null,
        entityId: null,
        sentAt: null,
        error: null,
        createdAt: new Date("2026-08-20T00:00:00.000Z"),
      },
    ])

    const result = await listDispatches({})

    expect(result.nextCursor).toBeNull()
    // Both null is the third state: the row was written and the process died
    // before the send resolved. It must survive serialisation as null, not 0.
    expect(result.items[0]).toMatchObject({ sentAt: null, error: null })
    expect(result.items[0]!.createdAt).toBe("2026-08-20T00:00:00.000Z")
  })
})
