import { dec, sum, toMoneyString } from "../payroll/payroll.money"
import type { OpportunityLineSummary, OpportunitySummary } from "./sales.types"

export function presentLine(row: any): OpportunityLineSummary {
  return {
    id: row.id, opportunityId: row.opportunityId, product: row.product,
    oemBrand: row.oemBrand ?? null, model: row.model ?? null, quantity: row.quantity ?? null,
    unitValue: row.unitValue == null ? null : toMoneyString(dec(row.unitValue)),
    lineValue: row.lineValue == null ? null : toMoneyString(dec(row.lineValue)),
    note: row.note ?? null, order: row.order,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}

export function presentOpportunity(row: any): OpportunitySummary {
  const rows = row.lines ?? []
  const priced = rows.filter((line: any) => line.lineValue != null)
  const total = sum(priced.map((line: any) => dec(line.lineValue)))
  const amount = row.amount == null ? null : dec(row.amount)
  return {
    id: row.id, serial: row.serial, salesAccountId: row.salesAccountId,
    salesAccountName: row.salesAccount?.name ?? "", name: row.name, track: row.track,
    amount: amount ? toMoneyString(amount) : null, currency: row.currency,
    expectedCloseDate: row.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    oemAccountManager: row.oemAccountManager ?? null, status: row.status,
    statusReason: row.statusReason ?? null, closedAt: row.closedAt?.toISOString() ?? null,
    stage: row.stage, stageChangedAt: row.stageChangedAt.toISOString(),
    nextStep: row.nextStep ?? null,
    nextStepDueOn: row.nextStepDueOn?.toISOString().slice(0, 10) ?? null,
    ownerEmployeeId: row.ownerEmployeeId, ownerName: row.owner?.fullName ?? "",
    wonByEmployeeId: row.wonByEmployeeId ?? null,
    lastActivityAt: row.lastActivityAt.toISOString(), createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), lines: rows.map(presentLine),
    lineTotal: toMoneyString(total), unpricedLineCount: rows.length - priced.length,
    amountDiffersFromLines: amount !== null && rows.length > 0 && !amount.equals(total),
  }
}
