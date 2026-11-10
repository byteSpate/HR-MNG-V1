import { describe, expect, it } from "vitest"

import { closeTargetFor, deliveriesFor, REQUEST_KINDS } from "./inbox.rules"
import type { EventLike } from "./inbox.types"

function ev(type: string, extra: Partial<EventLike> = {}): EventLike {
  return {
    type,
    actorUserId: "u-actor",
    entity: "X",
    entityId: "x-1",
    subjectEmployeeId: "emp-1",
    managerEmployeeId: "emp-mgr",
    targetRoles: [],
    companyWide: false,
    audienceDepartmentId: null,
    payload: null,
    ...extra,
  }
}

describe("deliveriesFor", () => {
  it("sends a leave request to every HR Admin and Super Admin as Important", () => {
    expect(deliveriesFor(ev("leave.requested"))).toEqual([
      { tab: "IMPORTANT", audience: { kind: "roles", roles: ["HR_ADMIN", "SUPER_ADMIN"] } },
    ])
  })

  it("sends an expense claim to Finance and Super Admin", () => {
    expect(deliveriesFor(ev("expense.submitted"))).toEqual([
      { tab: "IMPORTANT", audience: { kind: "roles", roles: ["FINANCE_OFFICER", "SUPER_ADMIN"] } },
    ])
  })

  it("sends an attendance fix request to the manager, or HR when there is none", () => {
    expect(deliveriesFor(ev("attendance.regularised"))).toEqual([
      { tab: "IMPORTANT", audience: { kind: "managerOrHr" } },
    ])
  })

  it("sends a payslip to the employee only, never to a manager", () => {
    const out = deliveriesFor(ev("payslip.published"))
    expect(out).toEqual([{ tab: "PRIMARY", audience: { kind: "subject" } }])
  })

  it("sends nothing for a plain attendance approval", () => {
    expect(deliveriesFor(ev("attendance.decided", { payload: { decision: "APPROVE" } }))).toEqual([])
    expect(deliveriesFor(ev("attendance.bulk_decided", { payload: { decision: "APPROVE", attendanceIds: ["a1"] } }))).toEqual([])
  })

  it("tells the employee when their attendance day is rejected", () => {
    expect(deliveriesFor(ev("attendance.decided", { payload: { decision: "REJECT" } }))).toEqual([
      { tab: "PRIMARY", audience: { kind: "subject" } },
    ])
    expect(
      deliveriesFor(ev("attendance.bulk_decided", { payload: { decision: "REJECT", attendanceIds: ["a1", "a2"] } }))
    ).toEqual([{ tab: "PRIMARY", audience: { kind: "attendanceOwners", attendanceIds: ["a1", "a2"] } }])
  })

  it("tells the employee when HR changes their attendance record", () => {
    expect(deliveriesFor(ev("attendance.corrected"))).toEqual([{ tab: "PRIMARY", audience: { kind: "subject" } }])
  })

  it("makes an automatic check-out Important for the employee", () => {
    expect(deliveriesFor(ev("attendance.auto_closed"))).toEqual([{ tab: "IMPORTANT", audience: { kind: "subject" } }])
  })

  it("sends a role change to the user whose role changed", () => {
    expect(deliveriesFor(ev("user.role_changed", { entity: "USER", entityId: "u-target" }))).toEqual([
      { tab: "PRIMARY", audience: { kind: "user", userId: "u-target" } },
    ])
  })

  it("sends meeting changes to the people in the meeting", () => {
    expect(deliveriesFor(ev("sales.meeting.rescheduled", { payload: { meetingId: "m-1" } }))).toEqual([
      { tab: "PRIMARY", audience: { kind: "meetingAttendees", meetingId: "m-1" } },
    ])
  })

  it("sends a meeting event with no meeting id to nobody", () => {
    expect(deliveriesFor(ev("sales.meeting.scheduled", { payload: null }))).toEqual([])
  })

  it("sends an announcement to the announcement's own audience", () => {
    expect(deliveriesFor(ev("announcement.published"))).toEqual([
      { tab: "PRIMARY", audience: { kind: "eventAudience" } },
    ])
  })

  it("treats everything else as company activity", () => {
    expect(deliveriesFor(ev("sales.funnel.cell_changed"))).toEqual([])
    expect(deliveriesFor(ev("employee.joined"))).toEqual([])
    expect(deliveriesFor(ev("sales.meeting.completed", { payload: { meetingId: "m-1" } }))).toEqual([])
  })
})

describe("closeTargetFor", () => {
  it("closes the leave request when it is decided or cancelled", () => {
    for (const t of ["leave.approved", "leave.rejected", "leave.cancelled"]) {
      expect(closeTargetFor(ev(t, { entity: "LEAVE_REQUEST", entityId: "lr-1" }))).toEqual({
        entity: "LEAVE_REQUEST",
        entityIds: ["lr-1"],
      })
    }
  })

  it("does not close anything when a request is made", () => {
    expect(closeTargetFor(ev("leave.requested"))).toBeNull()
    expect(closeTargetFor(ev("sales.funnel.cell_changed"))).toBeNull()
  })

  it("closes every record in a bulk attendance decision", () => {
    expect(
      closeTargetFor(ev("attendance.bulk_decided", { entity: "ATTENDANCE", payload: { attendanceIds: ["a1", "a2"] } }))
    ).toEqual({ entity: "ATTENDANCE", entityIds: ["a1", "a2"] })
  })

  it("closes the asset hand-over item when the employee accepts it", () => {
    // `asset.assigned` is filed under ASSET; `asset.acknowledged` under
    // ASSET_ASSIGNMENT with the same asset id. The close must hit the first.
    expect(closeTargetFor(ev("asset.acknowledged", { entity: "ASSET_ASSIGNMENT", entityId: "as-1" }))).toEqual({
      entity: "ASSET",
      entityIds: ["as-1"],
    })
  })
})

describe("REQUEST_KINDS", () => {
  it("holds the approval requests and nothing that is news", () => {
    expect(REQUEST_KINDS.has("leave.requested")).toBe(true)
    expect(REQUEST_KINDS.has("payroll.run.submitted")).toBe(true)
    expect(REQUEST_KINDS.has("leave.approved")).toBe(false)
    expect(REQUEST_KINDS.has("asset.assigned")).toBe(false)
  })
})
