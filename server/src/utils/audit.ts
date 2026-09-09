/**
 * The shared change log.
 *
 * Polymorphic `entity` + `entityId` rather than one typed audit table per
 * module, because the read pattern is always "what happened to this thing"
 * or "what happened this month", and neither wants a join.
 *
 * Called inside the same transaction as the change it records — a write that
 * succeeds without its audit row is a bug, matching `attendance.audit.ts`.
 *
 * Distinct from the event log: this is one row per *record*, `emitEvent` is
 * one row per *user action*. Bulk-approving a fortnight for sixteen people is
 * 160 audit rows and one event.
 */

import type { Prisma } from "../generated/prisma/client"

export type AuditEntity =
  | "PAYROLL_RUN"
  | "PAYSLIP"
  | "SALARY_STRUCTURE"
  | "ADJUSTMENT"
  | "EXPENSE_CLAIM"
  | "SETTLEMENT"
  | "EXCHANGE_RATE"
  | "EMPLOYEE_EXIT"
  | "EMPLOYEE_SALARY_STRUCTURE"
  | "EMPLOYEE_DOCUMENT"
  | "EMPLOYEE_PROFILE"
  // The sign-in identity and its capabilities, changed by HR on somebody
  // else's behalf. Separate from EMPLOYEE_PROFILE because login addresses and
  // authorization grants belong to the account, not the person's HR record.
  | "USER_ACCOUNT"
  // Sales Hub. USER_ACCOUNT already covers granting and revoking salesRole,
  // so it is not repeated here.
  | "SALES_ACCOUNT"
  | "SALES_ACCOUNT_ASSIGNMENT"
  | "SALES_CONTACT"
  | "SALES_COMMUNICATION"
  | "ASSET"
  | "ASSET_CATEGORY"
  | "ASSET_ASSIGNMENT"
  | "ASSET_REQUEST"
  | "ASSET_REPAIR"
  | "ASSET_RECOVERY"
  | "DEPRECIATION_RUN"
  | "COST"
  | "COST_COMMITMENT"
  | "COST_CATEGORY"
  // Accounting. The ledger's own change log; the journal lifecycle is the
  // main consumer, since a DRAFT edit must be recoverable after the fact.
  | "JOURNAL"
  | "ACCOUNT"
  | "FINANCIAL_YEAR"
  | "ACCOUNTING_PERIOD"
  | "STATEMENT_NOTE"
  | "POSTING_RULE"
  | "EXPENSE_CATEGORY"
  // Reference data. Editable from the Settings screens rather than the seed,
  // so a rename or a delete needs the same trail as a payroll change.
  | "DEPARTMENT"
  | "SHIFT"
  | "LEAVE_TYPE"

export type AuditAction =
  | "CREATE"
  | "PROCESS"
  | "SUBMIT"
  | "APPROVE"
  | "REJECT"
  | "DISBURSE"
  | "PAY"
  | "UPDATE"
  | "DELETE"
  | "CAPITALISE"
  | "ASSIGN"
  | "ACKNOWLEDGE"
  | "RETURN"
  | "SEND_REPAIR"
  | "RECEIVE_REPAIR"
  | "RETIRE"
  | "MARK_LOST"
  | "WAIVE"
  | "FULFIL"
  | "ORDER"
  | "IMPORT"
  | "CANCEL"
  | "POST"
  | "REVERSE"
  | "CLOSE"
  | "REOPEN"
  | "LOCK"

export interface AuditEntry {
  entity: AuditEntity
  entityId: string
  action: AuditAction
  changedBy?: string | null
  /** Only the fields that changed, not whole snapshots. */
  before?: Prisma.InputJsonValue
  after?: Prisma.InputJsonValue
  note?: string | null
}

export function writeAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  return tx.auditLog.create({
    data: {
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      changedBy: entry.changedBy ?? null,
      before: entry.before,
      after: entry.after,
      note: entry.note ?? null,
    },
  })
}

export function listAudits(
  entity: AuditEntity,
  entityId: string,
  tx: Prisma.TransactionClient
) {
  return tx.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { changedAt: "asc" },
  })
}
