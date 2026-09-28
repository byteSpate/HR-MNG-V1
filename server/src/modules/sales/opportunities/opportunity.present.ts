import { dec, sum, toMoneyString, type Money } from "../../payroll/payroll.money"
import { linesMargin, marginAmount } from "../sales.margin"
import type { OpportunityLineSummary, OpportunitySummary } from "../sales.types"

const moneyOrNull = (value: Money | null) => (value === null ? null : toMoneyString(value))

export function presentLine(row: any): OpportunityLineSummary {
  return {
    id: row.id, opportunityId: row.opportunityId, product: row.product,
    oemBrand: row.oemBrand ?? null, model: row.model ?? null, quantity: row.quantity ?? null,
    unitValue: row.unitValue == null ? null : toMoneyString(dec(row.unitValue)),
    lineValue: row.lineValue == null ? null : toMoneyString(dec(row.lineValue)),
    marginPercent: row.marginPercent == null ? null : dec(row.marginPercent).toFixed(2),
    // Worked out here, never stored, so it follows the Total price. Null when
    // the price or the percentage is missing: "no margin yet", never ৳0.
    marginAmount: moneyOrNull(marginAmount(row.lineValue, row.marginPercent)),
    note: row.note ?? null, order: row.order,
    supplier: row.supplier ? { id: row.supplier.id, name: row.supplier.name } : null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}

export function presentOpportunity(row: any, canManage = true): OpportunitySummary {
  const rows = row.lines ?? []
  const priced = rows.filter((line: any) => line.lineValue != null)
  const total = sum(priced.map((line: any) => dec(line.lineValue)))
  const amount = row.amount == null ? null : dec(row.amount)
  const margin = linesMargin(rows)
  return {
    id: row.id, serial: row.serial, salesAccountId: row.salesAccountId,
    salesAccountName: row.salesAccount?.name ?? "", name: row.name, track: row.track,
    amount: amount ? toMoneyString(amount) : null, currency: row.currency,
    // The deal's margin is its products' margins, worked out here and never
    // stored. Null when no product carries one: "no margin yet", never ৳0.
    marginAmount: margin.value,
    unmarginedLineCount: margin.missing,
    expectedCloseDate: row.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    oemAccountManager: row.oemAccountManager ?? null, status: row.status,
    statusReason: row.statusReason ?? null, closedAt: row.closedAt?.toISOString() ?? null,
    stage: row.stage, stageChangedAt: row.stageChangedAt.toISOString(),
    nextStep: row.nextStep ?? null,
    nextStepDueOn: row.nextStepDueOn?.toISOString().slice(0, 10) ?? null,
    // The weekly report Application column, answered on the deal (§26.9).
    softwareNeeded: row.softwareNeeded ?? null,
    ownerEmployeeId: row.ownerEmployeeId, ownerName: row.owner?.fullName ?? "",
    wonByEmployeeId: row.wonByEmployeeId ?? null,
    lastActivityAt: row.lastActivityAt.toISOString(), createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(), lines: rows.map(presentLine),
    lineTotal: toMoneyString(total), unpricedLineCount: rows.length - priced.length,
    // `priced.length`, not `rows.length`. Lines nobody has costed are not
    // summed as zero, so when none of them carries a value there is no line
    // total to differ from. Comparing anyway reports a difference on every
    // uncosted deal — and the one remedy offered for that is "set deal value
    // to line total", which is zero, so pressing it would wipe a real number
    // in the name of tidying up.
    amountDiffersFromLines: amount !== null && priced.length > 0 && !amount.equals(total),
    // Decided by the caller, which knows the actor. Defaults to true because
    // every other call site is a write the actor just made.
    canManage,
  }
}
