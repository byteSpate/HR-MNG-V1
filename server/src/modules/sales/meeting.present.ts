import { env } from "../../config/env"
import type { SalesMeetingSummary } from "./sales.types"

/** "Sun 20 Sep, 10:00" in office time, for event titles and emails. */
export function whenLabel(at: Date): string {
  return at.toLocaleString("en-GB", {
    timeZone: env.APP_TIMEZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** How a person says where a meeting happens. A visit is "at the customer". */
export const MEETING_MODE_LABEL: Record<string, string> = {
  CUSTOMER_SITE: "At the customer",
  OUR_OFFICE: "At our office",
  ONLINE: "Online",
}

export const MEETING_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Scheduled",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
}

export function presentMeeting(row: any, canManage = true): SalesMeetingSummary {
  return {
    id: row.id,
    salesAccountId: row.salesAccountId,
    salesAccountName: row.salesAccount?.name ?? "",
    opportunityId: row.opportunityId ?? null,
    opportunitySerial: row.opportunity?.serial ?? null,
    opportunityName: row.opportunity?.name ?? null,
    title: row.title,
    mode: row.mode,
    scheduledAt: row.scheduledAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    location: row.location ?? null,
    notes: row.notes ?? null,
    status: row.status,
    cancelReason: row.cancelReason ?? null,
    outcome: row.outcome ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    attendees: (row.attendees ?? []).map((attendee: any) => ({
      id: attendee.id,
      side: attendee.side,
      employeeId: attendee.employeeId ?? null,
      contactId: attendee.contactId ?? null,
      // An employee or a saved contact is named from their own record, so a
      // renamed contact reads correctly everywhere they appear.
      name: attendee.employee?.fullName ?? attendee.contact?.name ?? attendee.name ?? "",
      designation: attendee.designation ?? null,
    })),
    // Decided by the caller, which knows the actor. Defaults to true because
    // every other call site is a write the actor just made.
    canManage,
  }
}
