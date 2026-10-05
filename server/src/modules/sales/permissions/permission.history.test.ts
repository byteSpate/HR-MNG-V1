import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: { auditLog: { findMany: vi.fn() }, user: { findMany: vi.fn() } },
}))

import prisma from "../../../config/prisma"
import { listPermissionHistory } from "./permission.history"

beforeEach(() => vi.clearAllMocks())

describe("listPermissionHistory", () => {
  it("lists the newest 50 changes with the switch's label and who made them", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { entityId: "task.create", changedBy: "u-1", changedAt: new Date("2026-10-05T09:00:00Z"), after: { enabled: false } },
      { entityId: "old.removed.key", changedBy: null, changedAt: new Date("2026-10-04T09:00:00Z"), after: { enabled: true } },
    ] as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u-1", displayName: null, email: "k@d.c", employee: { fullName: "Karim" } },
    ] as never)

    const rows = await listPermissionHistory()
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entity: "SALES_PERMISSION" },
        orderBy: { changedAt: "desc" },
        take: 50,
      })
    )
    expect(rows[0]).toEqual({
      key: "task.create",
      label: "Create a Task",
      enabled: false,
      changedAt: "2026-10-05T09:00:00.000Z",
      changedByName: "Karim",
    })
    // A switch that no longer exists keeps its key as its label, and its row.
    expect(rows[1]).toMatchObject({ key: "old.removed.key", label: "old.removed.key", changedByName: null })
  })

  it("answers an empty list when nothing was ever changed", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never)
    expect(await listPermissionHistory()).toEqual([])
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })
})
