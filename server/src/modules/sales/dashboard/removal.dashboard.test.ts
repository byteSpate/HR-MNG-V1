import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: { salesCollaboratorRemoval: { count: vi.fn() } },
}))

import prisma from "../../../config/prisma"
import { removalActionRows } from "./removal.dashboard"

const ADMIN = { sub: "u-0", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const USER = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any

beforeEach(() => vi.clearAllMocks())

describe("removalActionRows", () => {
  it("gives a Sales Admin one row, counted from the pending requests", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.count).mockResolvedValue(3 as never)
    const rows = await removalActionRows(ADMIN)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: "removals", count: 3, href: "/settings" })
    expect(prisma.salesCollaboratorRemoval.count).toHaveBeenCalledWith({ where: { status: "PENDING" } })
  })

  it("still shows the row, with a count of 0 and a plain line, when nothing waits", async () => {
    vi.mocked(prisma.salesCollaboratorRemoval.count).mockResolvedValue(0 as never)
    const [row] = await removalActionRows(ADMIN)
    expect(row.count).toBe(0)
    expect(row.detail).toBe("Nothing is waiting")
  })

  it("gives a Sales User no row and asks the database nothing", async () => {
    expect(await removalActionRows(USER)).toEqual([])
    expect(prisma.salesCollaboratorRemoval.count).not.toHaveBeenCalled()
  })
})
