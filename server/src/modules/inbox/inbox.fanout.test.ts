import { beforeEach, describe, expect, it, vi } from "vitest"

// The global test setup replaces this module with a no-op so the many service
// tests whose fake `tx` has no `notification` table keep working. This file
// tests the real thing.
vi.unmock("./inbox.fanout")

import type { Event } from "../../generated/prisma/client"
import type { EventTx } from "../event/event.types"
import { closeRequest, fanOutEvent } from "./inbox.fanout"

const NOW = new Date("2026-11-10T06:00:00.000Z")

interface FakeUser { id: string; role: string; isActive: boolean; employeeId?: string; departmentId?: string }

function fakeTx(users: FakeUser[]) {
  const byEmployee = (id: string) => users.find((u) => u.employeeId === id)
  return {
    notification: {
      createMany: vi.fn(async ({ data }: { data: unknown[]; skipDuplicates?: boolean }) => ({ count: data.length })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: any }) => {
        let list = users.filter((u) => u.isActive)
        if (where.id?.in) list = list.filter((u) => where.id.in.includes(u.id))
        if (where.role?.in) list = list.filter((u) => where.role.in.includes(u.role))
        if (where.employee?.departmentId) list = list.filter((u) => u.departmentId === where.employee.departmentId)
        return list.map((u) => ({ id: u.id }))
      }),
    },
    employee: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const u = byEmployee(where.id)
        return u ? { userId: u.id } : null
      }),
    },
    attendance: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ employee: { userId: id === "att-1" ? "u-emp" : "u-emp2" } }))
      ),
    },
    salesMeetingAttendee: {
      findMany: vi.fn(async () => [{ employee: { userId: "u-emp" } }, { employee: { userId: "u-emp2" } }]),
    },
  }
}

const USERS: FakeUser[] = [
  { id: "u-emp", role: "EMPLOYEE", isActive: true, employeeId: "emp-1", departmentId: "d-1" },
  { id: "u-emp2", role: "EMPLOYEE", isActive: true, employeeId: "emp-2", departmentId: "d-2" },
  { id: "u-mgr", role: "REPORTING_MANAGER", isActive: true, employeeId: "emp-mgr", departmentId: "d-1" },
  { id: "u-hr1", role: "HR_ADMIN", isActive: true },
  { id: "u-hr2", role: "HR_ADMIN", isActive: true },
  { id: "u-hr-gone", role: "HR_ADMIN", isActive: false },
  { id: "u-sa", role: "SUPER_ADMIN", isActive: true },
]

function event(extra: Partial<Event>): Event {
  return {
    id: "evt-1",
    type: "leave.requested",
    severity: "INFO",
    actorUserId: "u-emp",
    entity: "LEAVE_REQUEST",
    entityId: "lr-1",
    subjectEmployeeId: "emp-1",
    managerEmployeeId: "emp-mgr",
    targetRoles: [],
    companyWide: false,
    audienceDepartmentId: null,
    title: "Casual leave requested",
    meta: "Rahim · Nov 12",
    href: "/leave",
    payload: null,
    createdAt: NOW,
    ...extra,
  } as Event
}

let tx: ReturnType<typeof fakeTx>
const asTx = () => tx as unknown as EventTx
const rows = () => tx.notification.createMany.mock.calls.flatMap((c: any[]) => c[0].data)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  tx = fakeTx(USERS)
})

describe("fanOutEvent", () => {
  it("sends a leave request to every active HR Admin and Super Admin as Important", async () => {
    await fanOutEvent(asTx(), event({}))

    expect(rows().map((r: any) => r.userId).sort()).toEqual(["u-hr1", "u-hr2", "u-sa"])
    for (const r of rows()) {
      expect(r).toMatchObject({
        tab: "IMPORTANT",
        kind: "leave.requested",
        eventId: "evt-1",
        entity: "LEAVE_REQUEST",
        entityId: "lr-1",
        title: "Casual leave requested",
        meta: "Rahim · Nov 12",
        href: "/leave",
      })
    }
    expect(tx.notification.createMany.mock.calls[0][0].skipDuplicates).toBe(true)
  })

  it("never tells the actor about their own action", async () => {
    await fanOutEvent(asTx(), event({ actorUserId: "u-hr1" }))
    expect(rows().map((r: any) => r.userId)).not.toContain("u-hr1")
  })

  it("closes every approver's open item when the request is decided, and tells the employee", async () => {
    await fanOutEvent(asTx(), event({ type: "leave.approved", actorUserId: "u-hr1" }))

    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { entity: "LEAVE_REQUEST", entityId: { in: ["lr-1"] }, tab: "IMPORTANT", closedAt: null },
      data: { closedAt: NOW },
    })
    expect(rows()).toEqual([expect.objectContaining({ userId: "u-emp", tab: "PRIMARY" })])
  })

  it("sends an attendance fix request to HR when the employee has no manager", async () => {
    await fanOutEvent(
      asTx(),
      event({ type: "attendance.regularised", entity: "ATTENDANCE", managerEmployeeId: null })
    )
    expect(rows().map((r: any) => r.userId).sort()).toEqual(["u-hr1", "u-hr2", "u-sa"])
  })

  it("sends an attendance fix request to the manager when there is one", async () => {
    await fanOutEvent(asTx(), event({ type: "attendance.regularised", entity: "ATTENDANCE" }))
    expect(rows().map((r: any) => r.userId)).toEqual(["u-mgr"])
  })

  it("holds a scheduled announcement until its publish time", async () => {
    await fanOutEvent(
      asTx(),
      event({
        type: "announcement.published",
        actorUserId: "u-hr1",
        companyWide: true,
        payload: { publishAt: "2026-12-01T03:00:00.000Z" },
      })
    )
    expect(rows().length).toBeGreaterThan(0)
    for (const r of rows()) expect(r.visibleFrom).toEqual(new Date("2026-12-01T03:00:00.000Z"))
  })

  it("sends a department announcement to that department only", async () => {
    await fanOutEvent(
      asTx(),
      event({ type: "announcement.published", actorUserId: "u-hr1", audienceDepartmentId: "d-1", payload: {} })
    )
    expect(rows().map((r: any) => r.userId).sort()).toEqual(["u-emp", "u-mgr"])
  })

  it("tells each employee whose day was rejected in a bulk decision", async () => {
    await fanOutEvent(
      asTx(),
      event({
        type: "attendance.bulk_decided",
        actorUserId: "u-mgr",
        entity: "ATTENDANCE",
        payload: { decision: "REJECT", attendanceIds: ["att-1", "att-2"] },
      })
    )
    expect(rows().map((r: any) => r.userId).sort()).toEqual(["u-emp", "u-emp2"])
  })

  it("closes an older open request for the same thing before a new one is sent", async () => {
    // A claim edited and sent again must not leave the first copy waiting.
    await fanOutEvent(asTx(), event({ type: "expense.submitted", entity: "EXPENSE_CLAIM", entityId: "c-1" }))
    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { entity: "EXPENSE_CLAIM", entityId: { in: ["c-1"] }, tab: "IMPORTANT", closedAt: null },
      data: { closedAt: NOW },
    })
  })

  it("writes nothing for company activity", async () => {
    await fanOutEvent(asTx(), event({ type: "sales.funnel.cell_changed" }))
    expect(tx.notification.createMany).not.toHaveBeenCalled()
    expect(tx.notification.updateMany).not.toHaveBeenCalled()
  })
})

describe("closeRequest", () => {
  it("closes the open Important items for one request", async () => {
    await closeRequest(asTx(), { entity: "SETTLEMENT", entityIds: ["s-1"] })
    expect(tx.notification.updateMany).toHaveBeenCalledWith({
      where: { entity: "SETTLEMENT", entityId: { in: ["s-1"] }, tab: "IMPORTANT", closedAt: null },
      data: { closedAt: NOW },
    })
  })
})
