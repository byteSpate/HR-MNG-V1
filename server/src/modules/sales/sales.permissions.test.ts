import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    $transaction: vi.fn(),
    salesPermission: { findMany: vi.fn(), upsert: vi.fn() },
    user: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import prisma from "../../config/prisma"
import {
  SALES_PERMISSIONS,
  canDo,
  clearPermissionCache,
  getPermissionMap,
  listPermissions,
  myPermissions,
  savePermissions,
} from "./sales.permissions"

const USER = { sub: "u-2", role: "EMPLOYEE", email: "a@b.c", mustChangePassword: false, salesRole: "SALES_USER" } as any
const ADMIN = { ...USER, sub: "u-1", salesRole: "SALES_ADMIN" } as any
const SUPER = { ...USER, sub: "u-0", role: "SUPER_ADMIN", salesRole: null } as any
const OUTSIDER = { ...USER, salesRole: null } as any

beforeEach(() => {
  vi.clearAllMocks()
  clearPermissionCache()
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: any) => fn(prisma)) as never)
  vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("the catalog", () => {
  it("has unique keys", () => {
    const keys = SALES_PERMISSIONS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("keeps today's behaviour by default: only account.create and the four team powers are off", () => {
    const off = SALES_PERMISSIONS.filter((p) => !p.default).map((p) => p.key)
    expect([...off].sort()).toEqual(
      ["account.create", "target.set", "team.dashboard", "team.funnel", "team.weekly"].sort()
    )
    expect(SALES_PERMISSIONS.filter((p) => p.phase === 1)).toHaveLength(20)
  })
})

describe("getPermissionMap", () => {
  it("answers the catalog defaults when the table is empty", async () => {
    const map = await getPermissionMap()
    expect(map["opportunity.create"]).toBe(true)
    expect(map["account.create"]).toBe(false)
  })

  it("lets a stored row beat the default", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([
      { key: "opportunity.create", enabled: false },
      { key: "account.create", enabled: true },
    ] as never)
    const map = await getPermissionMap()
    expect(map["opportunity.create"]).toBe(false)
    expect(map["account.create"]).toBe(true)
  })

  it("ignores a stored row whose key is not in the catalog", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "old.removed.key", enabled: false }] as never)
    const map = await getPermissionMap()
    expect(Object.keys(map)).not.toContain("old.removed.key")
  })

  it("reads once, then serves from the cache for 30 seconds", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-05T10:00:00Z"))
    await getPermissionMap()
    vi.setSystemTime(new Date("2026-10-05T10:00:29Z"))
    await getPermissionMap()
    expect(prisma.salesPermission.findMany).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date("2026-10-05T10:00:31Z"))
    await getPermissionMap()
    expect(prisma.salesPermission.findMany).toHaveBeenCalledTimes(2)
  })

  it("reads again after clearPermissionCache", async () => {
    await getPermissionMap()
    clearPermissionCache()
    await getPermissionMap()
    expect(prisma.salesPermission.findMany).toHaveBeenCalledTimes(2)
  })
})

describe("canDo", () => {
  beforeEach(() => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "opportunity.create", enabled: false }] as never)
  })

  it("never refuses a Sales Admin, even when the row is off", async () => {
    expect(await canDo(ADMIN, "opportunity.create")).toBe(true)
  })

  it("never refuses the Super Admin", async () => {
    expect(await canDo(SUPER, "opportunity.create")).toBe(true)
  })

  it("follows the switch for a Sales User", async () => {
    expect(await canDo(USER, "opportunity.create")).toBe(false)
    expect(await canDo(USER, "opportunity.change_stage")).toBe(true)
  })

  it("refuses a person with no Sales Hub access", async () => {
    expect(await canDo(OUTSIDER, "opportunity.change_stage")).toBe(false)
  })
})

describe("myPermissions", () => {
  it("answers true for every switch to a Sales Admin", async () => {
    const map = await myPermissions(ADMIN)
    expect(Object.values(map).every(Boolean)).toBe(true)
  })

  it("answers false for every switch to a person with no Sales Hub access", async () => {
    const map = await myPermissions(OUTSIDER)
    expect(Object.values(map).some(Boolean)).toBe(false)
  })
})

describe("listPermissions", () => {
  it("lists every switch with its value and who last changed it", async () => {
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([
      { key: "task.create", enabled: false, updatedBy: "u-1", updatedAt: new Date("2026-10-05T09:00:00Z") },
    ] as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u-1", displayName: null, email: "boss@demo.com", employee: { fullName: "Karim" } },
    ] as never)

    const rows = await listPermissions()
    const row = rows.find((r) => r.key === "task.create")!
    expect(row).toMatchObject({ enabled: false, default: true, changedByName: "Karim", changedAt: "2026-10-05T09:00:00.000Z" })
    const untouched = rows.find((r) => r.key === "meeting.create")!
    expect(untouched).toMatchObject({ enabled: true, changedAt: null, changedByName: null })
  })
})

describe("savePermissions", () => {
  it("refuses a key that is not in the catalog, and writes nothing", async () => {
    await expect(
      savePermissions([{ key: "task.create", enabled: false }, { key: "nope.nope", enabled: true }], ADMIN)
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prisma.salesPermission.upsert).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("saves a team switch now that it is available", async () => {
    await savePermissions([{ key: "team.funnel", enabled: true }], ADMIN)
    expect(prisma.salesPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "team.funnel" } })
    )
  })

  it("writes nothing when the value already matches the current one", async () => {
    await savePermissions([{ key: "task.create", enabled: true }], ADMIN)
    expect(prisma.salesPermission.upsert).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("writes a row and an audit entry for a real change", async () => {
    await savePermissions([{ key: "task.create", enabled: false }], ADMIN)
    expect(prisma.salesPermission.upsert).toHaveBeenCalledWith({
      where: { key: "task.create" },
      create: { key: "task.create", enabled: false, updatedBy: "u-1" },
      update: { enabled: false, updatedBy: "u-1" },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: "SALES_PERMISSION",
        entityId: "task.create",
        action: "UPDATE",
        changedBy: "u-1",
        before: { enabled: true },
        after: { enabled: false },
      }),
    })
  })

  it("compares with the stored row, not the default", async () => {
    // A real row always has `updatedAt` (the column is never empty), and the
    // list that `savePermissions` answers with reads it.
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([
      { key: "task.create", enabled: false, updatedBy: null, updatedAt: new Date("2026-10-05T09:00:00Z") },
    ] as never)
    await savePermissions([{ key: "task.create", enabled: true }], ADMIN)
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ before: { enabled: false }, after: { enabled: true } }),
    })
  })

  it("lets the last value win when a key is sent twice", async () => {
    await savePermissions(
      [{ key: "task.create", enabled: false }, { key: "task.create", enabled: true }],
      ADMIN
    )
    expect(prisma.salesPermission.upsert).not.toHaveBeenCalled()
  })

  it("clears the cache, so this server sees the change at once", async () => {
    await getPermissionMap()
    await savePermissions([{ key: "task.create", enabled: false }], ADMIN)
    vi.mocked(prisma.salesPermission.findMany).mockResolvedValue([{ key: "task.create", enabled: false }] as never)
    const map = await getPermissionMap()
    expect(map["task.create"]).toBe(false)
  })
})
