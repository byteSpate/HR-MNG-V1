import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => ({
  default: {
    employee: { findUnique: vi.fn() },
    event: { findMany: vi.fn() },
    notification: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

import prisma from "../../config/prisma"
import type { AccessTokenPayload } from "../auth/auth.types"
import { listInbox, markAllRead, markRead, unreadCount } from "./inbox.service"

const NOW = new Date("2026-11-10T06:00:00.000Z")
const db = prisma as unknown as {
  employee: { findUnique: ReturnType<typeof vi.fn> }
  event: { findMany: ReturnType<typeof vi.fn> }
  notification: Record<"count" | "findMany" | "findFirst" | "update" | "updateMany", ReturnType<typeof vi.fn>>
}

const actor = (role = "HR_ADMIN", sub = "u1") =>
  ({ sub, role, email: "a@demo.com", mustChangePassword: false, salesRole: null }) as unknown as AccessTokenPayload

const mine = (id: string, at: string, extra: Record<string, unknown> = {}) => ({
  id,
  tab: "IMPORTANT",
  title: `Mine ${id}`,
  meta: null,
  href: "/leave",
  readAt: null,
  closedAt: null,
  createdAt: new Date(at),
  ...extra,
})

const activity = (id: string, at: string) => ({
  id,
  title: `Activity ${id}`,
  meta: "x",
  href: null,
  createdAt: new Date(at),
})

beforeEach(() => {
  vi.clearAllMocks()
  db.employee.findUnique.mockResolvedValue({ id: "emp-1", departmentId: "d-1" })
  db.notification.findMany.mockResolvedValue([])
  db.event.findMany.mockResolvedValue([])
})

describe("unreadCount", () => {
  it("counts only my unread, open, visible notifications", async () => {
    db.notification.count.mockResolvedValue(3)

    await expect(unreadCount("u1", NOW)).resolves.toBe(3)
    expect(db.notification.count).toHaveBeenCalledWith({
      where: { userId: "u1", visibleFrom: { lte: NOW }, readAt: null, closedAt: null },
    })
  })
})

describe("listInbox", () => {
  it("lists the Important tab, newest first, with read and closed state", async () => {
    db.notification.findMany.mockResolvedValue([
      mine("n2", "2026-11-10T05:00:00.000Z"),
      mine("n1", "2026-11-09T05:00:00.000Z", { readAt: NOW, closedAt: NOW }),
    ])

    const page = await listInbox(actor(), { tab: "important" }, NOW)

    expect(db.notification.findMany.mock.calls[0][0].where).toMatchObject({
      userId: "u1",
      visibleFrom: { lte: NOW },
      tab: "IMPORTANT",
    })
    expect(page.items.map((i) => [i.id, i.unread, i.closed])).toEqual([
      ["n2", true, false],
      ["n1", false, true],
    ])
    expect(page.items[0].source).toBe("MINE")
    expect(page.nextCursor).toBeNull()
    expect(db.event.findMany).not.toHaveBeenCalled()
  })

  it("adds the unread filter when asked", async () => {
    await listInbox(actor(), { tab: "primary", unread: true }, NOW)
    expect(db.notification.findMany.mock.calls[0][0].where).toMatchObject({
      tab: "PRIMARY",
      readAt: null,
      closedAt: null,
    })
  })

  it("merges my notifications and company activity on the All tab, newest first", async () => {
    db.notification.findMany.mockResolvedValue([
      mine("n2", "2026-11-10T05:00:00.000Z"),
      mine("n1", "2026-11-08T05:00:00.000Z"),
    ])
    db.event.findMany.mockResolvedValue([
      activity("e2", "2026-11-09T05:00:00.000Z"),
      activity("e1", "2026-11-07T05:00:00.000Z"),
    ])

    const page = await listInbox(actor(), { tab: "all" }, NOW)

    expect(page.items.map((i) => i.id)).toEqual(["n2", "event:e2", "n1", "event:e1"])
    const ev = page.items.find((i) => i.id === "event:e2")!
    expect(ev).toMatchObject({ source: "ACTIVITY", tab: null, unread: false, closed: false })
    // An event that already made a row for me is shown once, as mine.
    expect(JSON.stringify(db.event.findMany.mock.calls[0][0].where)).toContain(
      JSON.stringify({ notifications: { none: { userId: "u1" } } })
    )
  })

  it("cuts the All tab to the limit and gives a cursor for the next page", async () => {
    db.notification.findMany.mockResolvedValue([
      mine("n2", "2026-11-10T05:00:00.000Z"),
      mine("n1", "2026-11-08T05:00:00.000Z"),
    ])
    db.event.findMany.mockResolvedValue([activity("e2", "2026-11-09T05:00:00.000Z")])

    const page = await listInbox(actor(), { tab: "all", limit: 2 }, NOW)

    expect(page.items.map((i) => i.id)).toEqual(["n2", "event:e2"])
    expect(page.nextCursor).toBe("2026-11-09T05:00:00.000Z|e2")
  })

  it("reads the next page from the cursor", async () => {
    await listInbox(actor(), { tab: "important", cursor: "2026-11-09T05:00:00.000Z|n5" }, NOW)
    expect(db.notification.findMany.mock.calls[0][0].where.OR).toEqual([
      { createdAt: { lt: new Date("2026-11-09T05:00:00.000Z") } },
      { createdAt: new Date("2026-11-09T05:00:00.000Z"), id: { lt: "n5" } },
    ])
  })

  it("only reads my notifications on All when mine is set (the bell)", async () => {
    await listInbox(actor(), { tab: "all", mine: true }, NOW)
    expect(db.event.findMany).not.toHaveBeenCalled()
  })

  it("works for a login with no employee record", async () => {
    db.employee.findUnique.mockResolvedValue(null)
    db.event.findMany.mockResolvedValue([activity("e1", "2026-11-07T05:00:00.000Z")])

    const page = await listInbox(actor("SUPER_ADMIN"), { tab: "all" }, NOW)
    expect(page.items.map((i) => i.id)).toEqual(["event:e1"])
  })

  it("refuses a broken cursor in plain words", async () => {
    await expect(listInbox(actor(), { tab: "all", cursor: "nonsense" }, NOW)).rejects.toMatchObject({
      statusCode: 400,
    })
  })
})

describe("markRead", () => {
  it("marks my notification read", async () => {
    db.notification.findFirst.mockResolvedValue({ id: "n1", readAt: null })
    await markRead("u1", "n1")
    expect(db.notification.findFirst).toHaveBeenCalledWith({ where: { id: "n1", userId: "u1" } })
    expect(db.notification.update).toHaveBeenCalledWith({ where: { id: "n1" }, data: { readAt: expect.any(Date) } })
  })

  it("does nothing more for one that is already read", async () => {
    db.notification.findFirst.mockResolvedValue({ id: "n1", readAt: NOW })
    await markRead("u1", "n1")
    expect(db.notification.update).not.toHaveBeenCalled()
  })

  it("refuses someone else's notification as not found", async () => {
    db.notification.findFirst.mockResolvedValue(null)
    await expect(markRead("u1", "n-of-u2")).rejects.toMatchObject({
      statusCode: 404,
      message: "This notification was not found. It may belong to someone else.",
    })
  })
})

describe("markAllRead", () => {
  it("marks all my unread visible notifications read", async () => {
    db.notification.updateMany.mockResolvedValue({ count: 4 })
    await expect(markAllRead("u1", NOW)).resolves.toBe(4)
    expect(db.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", visibleFrom: { lte: NOW }, readAt: null },
      data: { readAt: NOW },
    })
  })
})
