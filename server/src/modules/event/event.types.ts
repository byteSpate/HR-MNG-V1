/**
 * The event log's public shapes.
 *
 * An event is **one row per user action**, which is what separates it from
 * `AuditLog` and `AttendanceAudit` — those write one row per *record*.
 * Bulk-approving a fortnight of attendance for sixteen people is 160 audit
 * rows and exactly one event. Both are right; a feed built on the audit
 * tables would be 160 lines nobody reads, and an audit trail built on events
 * could not answer "who approved this specific day".
 */

import type { EventSeverity, Prisma, Role } from "../../generated/prisma/client"

/**
 * Every event this system can emit. A TS union in front of a `String`
 * column, matching `AuditLog.entity` — a new event type should be a
 * deploy, not a migration, and the union still makes a typo a compile error.
 */
export type EventType =
  | "leave.requested"
  | "leave.approved"
  | "leave.rejected"
  | "leave.cancelled"
  | "attendance.regularised"
  | "attendance.corrected"
  | "attendance.decided"
  | "attendance.auto_closed"
  | "attendance.bulk_decided"
  | "payroll.run.created"
  | "payroll.run.processed"
  | "payroll.run.submitted"
  | "payroll.run.approved"
  | "payroll.run.rejected"
  | "payroll.run.disbursed"
  | "payslip.published"
  | "expense.submitted"
  | "expense.approved"
  | "expense.rejected"
  | "expense.reimbursed"
  | "settlement.calculated"
  | "settlement.approved"
  | "settlement.paid"
  | "announcement.published"
  | "employee.joined"
  | "employee.exited"
  | "employee.bank_changed"
  | "employee.national_id_change_requested"
  | "user.role_changed"
  | "sales.account.created"
  | "sales.account.assigned"
  | "sales.account.reassigned"
  | "sales.account.status_changed"
  | "sales.contact.verified"
  | "asset.assigned"
  | "asset.acknowledged"
  | "asset.returned"
  | "asset.request.submitted"
  | "asset.request.approved"
  | "asset.request.ordered"
  | "asset.request.rejected"
  | "asset.retired"
  | "asset.marked_lost"
  | "asset.imported"
  | "asset.recovery.collected"
  // Fulfilment emits nothing of its own: it creates an assignment, which
  // already emits asset.assigned with the request id in the payload. Two
  // events for one action would put the same fact in the feed twice.
  //
  // Repairs emit nothing at all. Events are for people who need telling, and
  // nobody needs telling that a monitor went to the vendor. Repairs are
  // covered by AuditLog and by the open-repairs list.

/**
 * A transaction client, and *only* a transaction client.
 *
 * The `$connect?: never` is load-bearing rather than decorative:
 * `PrismaClient` is structurally assignable to `Prisma.TransactionClient`
 * (the deny-list only removes members), so without this the signature would
 * document an intent the compiler never enforced. An event that survives a
 * rolled-back transaction announces something that did not happen.
 *
 * `$connect` and not `$transaction`: Prisma 7 kept `$transaction` on the
 * interactive-transaction client, so branding on that one collapses the
 * whole intersection to `never`. `$connect` is on the deny-list and is not.
 */
export type EventTx = Prisma.TransactionClient & { $connect?: never }

interface EventBase {
  type: EventType
  /** Defaults to INFO. */
  severity?: EventSeverity
  /** Null means the system did it rather than a person. */
  actorUserId?: string | null
  /** Polymorphic, exactly as `AuditLog` is. */
  entity: string
  entityId: string
  /**
   * Overrides the manager resolved from the subject. Pass it only when the
   * subject's own reporting line is the wrong audience — otherwise let
   * `emitEvent` look it up, so the two never disagree.
   */
  managerEmployeeId?: string | null
  /** Frozen at emit. What a feed row reads. */
  title: string
  meta?: string | null
  /**
   * **Role-agnostic**, and prefixed by the client with its own route group:
   * `"/leave"` becomes `/manager/leave` or `/employee/leave` depending on who
   * is reading. One row is seen by an employee, their manager and HR, so a
   * frozen `/employee/leave` would be a broken link for two of the three.
   */
  href?: string | null
  /**
   * The facts behind the rendered strings, kept alongside rather than
   * instead: an email template needs more than a feed line, and a
   * notification must not have to parse `title` back apart.
   */
  payload?: Prisma.InputJsonValue
}

/**
 * At least one audience, enforced in the type rather than at runtime.
 *
 * An event with no audience is invisible to everyone: a row written, a
 * notification never sent, and nothing anywhere that says so. That failure
 * is silent, so it has to be impossible to write rather than caught late.
 */
type AudienceExtras = {
  subjectEmployeeId?: string | null
  targetRoles?: Role[]
  companyWide?: boolean
  /** A whole department — one row, not one per member. */
  audienceDepartmentId?: string | null
}

type EventAudience =
  | (AudienceExtras & { subjectEmployeeId: string })
  | (AudienceExtras & { targetRoles: [Role, ...Role[]] })
  | (AudienceExtras & { companyWide: true })
  | (AudienceExtras & { audienceDepartmentId: string })

export type EventInput = EventBase & EventAudience

/**
 * What a feed reads. Deliberately narrower than the row: `payload`,
 * `actorUserId` and the audience columns are how the log decides who sees
 * what, not something a client needs — and `payload` can carry figures that
 * `title` was written to keep off an open-plan screen.
 */
export interface EventItem {
  id: string
  type: EventType
  severity: EventSeverity
  entity: string
  entityId: string
  title: string
  meta: string | null
  href: string | null
  createdAt: string
}

export interface ListEventsOptions {
  limit?: number
  /** The id of the last item on the previous page. */
  cursor?: string
  entity?: string
  entityId?: string
  /** Narrow to one severity: a month of INFO rows otherwise hides the warnings. */
  severity?: EventSeverity
  /** Injectable clock, so the scheduled-announcement boundary is testable. */
  now?: Date
}

export interface EventPage {
  items: EventItem[]
  /** Null when this is the last page. */
  nextCursor: string | null
}
