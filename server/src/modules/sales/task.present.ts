import { formatDateOnly } from "../../utils/dates"
import type { SalesTaskSummary } from "./sales.types"

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
  return {
    id: row.id,
    origin: row.origin,
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
    overdue: row.status === "PENDING" && row.dueOn.getTime() < today.getTime(),
    canManage,
    createdAt: row.createdAt.toISOString(),
  }
}
