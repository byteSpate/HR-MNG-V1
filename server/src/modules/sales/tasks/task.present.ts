import { formatDateOnly } from "../../../utils/dates"
import { officeDateOf } from "../../attendance/attendance.time"
import type { SalesTaskSummary } from "../sales.types"

export const TASK_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  DONE: "Done",
  CANCELLED: "Cancelled",
}

/**
 * `today` is the office date, passed in so "overdue" is worked out once, at
 * read, against the same day the due filters use.
 */
export function presentTask(row: any, canManage: boolean, today: Date): SalesTaskSummary {
  // A task somebody gave: a meeting action item or a take-out. Both show who and on which day.
  const given = row.origin === "FUNNEL_MEETING" || row.origin === "TAKE_OUT"
  return {
    id: row.id,
    origin: row.origin,
    type: row.type ?? "OTHER",
    givenByName: given ? (row.assignedBy?.fullName ?? "Super Admin") : null,
    givenOn: given ? formatDateOnly(officeDateOf(row.createdAt)) : null,
    salesAccountId: row.salesAccountId ?? null,
    salesAccountName: row.salesAccount?.name ?? null,
    opportunityId: row.opportunityId ?? null,
    opportunitySerial: row.opportunity?.serial ?? null,
    opportunityName: row.opportunity?.name ?? null,
    meetingId: row.meetingId ?? null,
    meetingTitle: row.meeting?.title ?? null,
    title: row.title,
    detail: row.detail ?? null,
    dueOn: formatDateOnly(row.dueOn),
    priority: row.priority,
    assignedToEmployeeId: row.assignedToEmployeeId,
    assignedToName: row.assignedTo?.fullName ?? "",
    status: row.status,
    outcome: row.outcome ?? null,
    cancelReason: row.cancelReason ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    // The office day it was done, so a screen groups it under the right day
    // without knowing the office's time zone.
    doneOn: row.completedAt ? formatDateOnly(officeDateOf(row.completedAt)) : null,
    overdue: row.status === "PENDING" && row.dueOn.getTime() < today.getTime(),
    canManage,
    createdAt: row.createdAt.toISOString(),
  }
}
