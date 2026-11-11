/**
 * Types for the per-person notification inbox.
 *
 * The module is called `inbox` because `notification` was already taken by the
 * email dispatch log (`/api/emails`). The table is still `Notification`.
 */

import type { Role } from "../../generated/prisma/client"

export type Tab = "IMPORTANT" | "PRIMARY"

/** Who a notification goes to, as a rule. `inbox.fanout.ts` turns it into user ids. */
export type Audience =
  /** The user behind `event.subjectEmployeeId`. */
  | { kind: "subject" }
  /** One user named directly, e.g. the user whose role changed. */
  | { kind: "user"; userId: string }
  /** Every active user with one of these roles. */
  | { kind: "roles"; roles: Role[] }
  /** The user behind `event.managerEmployeeId`, or every active HR_ADMIN and SUPER_ADMIN when there is none. */
  | { kind: "managerOrHr" }
  /** The employee owning each attendance record. */
  | { kind: "attendanceOwners"; attendanceIds: string[] }
  /** Our side of a sales meeting. */
  | { kind: "meetingAttendees"; meetingId: string }
  /** The event's own company / department / role audience (announcements). */
  | { kind: "eventAudience" }

export interface Delivery {
  tab: Tab
  audience: Audience
}

/** The fields of an `Event` row the rules read. */
export interface EventLike {
  type: string
  actorUserId: string | null
  entity: string
  entityId: string
  subjectEmployeeId: string | null
  managerEmployeeId: string | null
  targetRoles: Role[]
  companyWide: boolean
  audienceDepartmentId: string | null
  payload: unknown
}

/** Which "waiting for you" items a decision closes. */
export interface CloseTarget {
  entity: string
  entityIds: string[]
  /** Close only these kinds. Left out: every open Important item for the thing. */
  kinds?: string[]
}

export type InboxTab = "important" | "primary" | "all"

/** One line on the bell or the Notifications page. */
export interface InboxItem {
  /** The notification id, or `event:<eventId>` for company activity. */
  id: string
  source: "MINE" | "ACTIVITY"
  tab: Tab | null
  title: string
  meta: string | null
  href: string | null
  /** Always false for company activity, which has no read state. */
  unread: boolean
  /** Someone already decided this request. */
  closed: boolean
  createdAt: string
}

export interface InboxPage {
  items: InboxItem[]
  nextCursor: string | null
}
