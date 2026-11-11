/**
 * Who gets a notification for each event, and in which tab.
 *
 * One table, so the rule for "who hears about a leave request" lives in one
 * place rather than in each service. Pure: no database here. An event type
 * that is not listed is company activity: it shows in the All tab through the
 * normal event feed and never adds to anyone's red number.
 *
 * Approvers match the route guards: leave `leave.routes.ts` REVIEWER_ROLES,
 * expense `expense.routes.ts` FINANCE_ROLES, asset requests / payroll runs /
 * settlements SUPER_ADMIN only, national ID HR_ADMIN + SUPER_ADMIN, attendance
 * the manager or HR (`attendance-digest.job.ts`).
 */

import type { Role } from "../../generated/prisma/client"
import type { CloseTarget, Delivery, EventLike, Tab } from "./inbox.types"

const HR: Role[] = ["HR_ADMIN", "SUPER_ADMIN"]
const FINANCE: Role[] = ["FINANCE_OFFICER", "SUPER_ADMIN"]
const SUPER: Role[] = ["SUPER_ADMIN"]

/** The 21:30 reminder's kind. Check-out, by hand or by the app, closes it. */
export const NOT_CHECKED_OUT = "reminder.not_checked_out"

type Rule = (e: EventLike) => Delivery[]

const toRoles = (tab: Tab, roles: Role[]): Rule => () => [{ tab, audience: { kind: "roles", roles } }]
const toSubject = (tab: Tab): Rule => () => [{ tab, audience: { kind: "subject" } }]

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined
}

function ids(payload: unknown, key: string): string[] {
  const value = field(payload, key)
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []
}

const onlyRejected =
  (rule: Rule): Rule =>
  (e) =>
    field(e.payload, "decision") === "REJECT" ? rule(e) : []

const toMeeting: Rule = (e) => {
  const meetingId = field(e.payload, "meetingId")
  return typeof meetingId === "string"
    ? [{ tab: "PRIMARY", audience: { kind: "meetingAttendees", meetingId } }]
    : []
}

const RULES: Record<string, Rule> = {
  // ── waiting for you ──
  "leave.requested": toRoles("IMPORTANT", HR),
  "expense.submitted": toRoles("IMPORTANT", FINANCE),
  "attendance.regularised": () => [{ tab: "IMPORTANT", audience: { kind: "managerOrHr" } }],
  "asset.request.submitted": toRoles("IMPORTANT", SUPER),
  "employee.national_id_change_requested": toRoles("IMPORTANT", HR),
  "payroll.run.submitted": toRoles("IMPORTANT", SUPER),
  "settlement.calculated": toRoles("IMPORTANT", SUPER),
  "asset.assigned": toSubject("IMPORTANT"),
  "sales.task.created": toSubject("IMPORTANT"),
  "attendance.auto_closed": toSubject("IMPORTANT"),

  // ── about you ──
  "leave.approved": toSubject("PRIMARY"),
  "leave.rejected": toSubject("PRIMARY"),
  "leave.cancelled": toSubject("PRIMARY"),
  "expense.approved": toSubject("PRIMARY"),
  "expense.rejected": toSubject("PRIMARY"),
  "expense.reimbursed": toSubject("PRIMARY"),
  "payslip.published": toSubject("PRIMARY"),
  "asset.request.approved": toSubject("PRIMARY"),
  "asset.request.ordered": toSubject("PRIMARY"),
  "asset.request.rejected": toSubject("PRIMARY"),
  "asset.returned": toSubject("PRIMARY"),
  "asset.recovery.collected": toSubject("PRIMARY"),
  "settlement.approved": toSubject("PRIMARY"),
  "settlement.paid": toSubject("PRIMARY"),
  "employee.bank_changed": toSubject("PRIMARY"),
  "attendance.corrected": toSubject("PRIMARY"),
  "attendance.decided": onlyRejected(toSubject("PRIMARY")),
  "attendance.bulk_decided": onlyRejected((e) => [
    { tab: "PRIMARY", audience: { kind: "attendanceOwners", attendanceIds: ids(e.payload, "attendanceIds") } },
  ]),
  // `entityId` is the user whose role changed; they may have no employee record.
  "user.role_changed": (e) => [{ tab: "PRIMARY", audience: { kind: "user", userId: e.entityId } }],
  // The subject of these is the new owner.
  "sales.account.assigned": toSubject("PRIMARY"),
  "sales.account.reassigned": toSubject("PRIMARY"),
  "sales.meeting.scheduled": toMeeting,
  "sales.meeting.rescheduled": toMeeting,
  "sales.meeting.cancelled": toMeeting,
  "announcement.published": () => [{ tab: "PRIMARY", audience: { kind: "eventAudience" } }],
}

export function deliveriesFor(event: EventLike): Delivery[] {
  return RULES[event.type]?.(event) ?? []
}

/** The approval requests. Used by the 2-day "still waiting" reminder. */
export const REQUEST_KINDS: ReadonlySet<string> = new Set([
  "leave.requested",
  "expense.submitted",
  "attendance.regularised",
  "asset.request.submitted",
  "employee.national_id_change_requested",
  "payroll.run.submitted",
  "settlement.calculated",
])

/** Decisions that end a request. Every open Important row for it closes, for every approver. */
const CLOSES = new Set([
  "leave.approved",
  "leave.rejected",
  "leave.cancelled",
  "expense.approved",
  "expense.rejected",
  "attendance.decided",
  "asset.request.approved",
  "asset.request.rejected",
  "payroll.run.approved",
  "payroll.run.rejected",
  "settlement.approved",
  // Closes the task's "due today" and "late" reminders.
  "sales.task.completed",
])

export function closeTargetFor(event: EventLike): CloseTarget | null {
  if (event.type === "attendance.bulk_decided") {
    return { entity: event.entity, entityIds: ids(event.payload, "attendanceIds") }
  }
  // Filed under ASSET_ASSIGNMENT, but the hand-over item is under ASSET with
  // the same asset id (see `asset.events.ts`).
  if (event.type === "asset.acknowledged") {
    return { entity: "ASSET", entityIds: [event.entityId] }
  }
  // An asset can come back, or be marked lost, before anyone accepted it.
  if (event.type === "asset.returned" || event.type === "asset.marked_lost") {
    return { entity: "ASSET", entityIds: [event.entityId] }
  }
  // The automatic check-out ends the 21:30 reminder. A fix request waiting on
  // the same attendance row is a different thing and stays open.
  if (event.type === "attendance.auto_closed") {
    return { entity: "ATTENDANCE", entityIds: [event.entityId], kinds: [NOT_CHECKED_OUT] }
  }
  // Filed under the account; the 30-minute reminder is under the meeting.
  // A moved meeting gets a new reminder for its new time.
  if (event.type === "sales.meeting.cancelled" || event.type === "sales.meeting.rescheduled") {
    const meetingId = field(event.payload, "meetingId")
    return typeof meetingId === "string" ? { entity: "SALES_MEETING", entityIds: [meetingId] } : null
  }
  return CLOSES.has(event.type) ? { entity: event.entity, entityIds: [event.entityId] } : null
}
