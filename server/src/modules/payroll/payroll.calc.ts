/**
 * Gross to net. This function is the module; everything else is plumbing.
 *
 * Pure — no Prisma, no Express, **and no currency**. One employee has exactly
 * one payment currency, so no payslip ever needs mixed-currency addition, and
 * conversion happens once on the totals outside this function. Converting per
 * line and summing gives a total that disagrees with the converted total, and
 * then the payslip's own lines would not add up.
 *
 * Rounding happens once per line and once per total, and every total is a sum
 * of already-rounded lines — never a rounded sum of unrounded ones. The
 * alternative is the single most reported payroll bug and the least
 * defensible: a document whose visible lines do not add up to its own total.
 */

import { dec, type Money, percentOf, prorate, round2, sum, toMoneyString } from "./payroll.money"
import type {
  AdjustmentInput,
  ComponentInput,
  PayslipInput,
  PayslipLine,
  PayslipResult,
} from "./payroll.types"

/** Payslip display order: sortOrder, then code so ties are deterministic. */
const byDisplayOrder = (a: ComponentInput, b: ComponentInput): number =>
  a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)

/**
 * A component's full-month value.
 *
 * Percentages resolve against the **full** basic, never a pro-rated one — see
 * `computePayslip` for why that matters on the deduction side.
 */
function resolveComponent(component: ComponentInput, basic: Money): Money {
  return component.calc === "PERCENT_OF_BASIC"
    ? percentOf(basic, component.value)
    : round2(component.value)
}

const toLine = (component: ComponentInput, amount: Money): PayslipLine => ({
  code: component.code,
  label: component.label,
  calc: component.calc,
  value: toMoneyString(component.value),
  amount: toMoneyString(amount),
})

const toAdjustmentLine = (adjustment: AdjustmentInput): PayslipLine => ({
  code: adjustment.code,
  label: adjustment.label,
  calc: "ADJUSTMENT",
  value: toMoneyString(adjustment.amount),
  amount: toMoneyString(adjustment.amount),
  kind: adjustment.kind,
})

export function computePayslip(input: PayslipInput): PayslipResult {
  const basic = round2(input.basic)
  const ordered = [...input.components].sort(byDisplayOrder)

  // ── 1. Earnings at a full month ──────────────────────────────────────────
  const earningLines: PayslipLine[] = [
    { code: "BASIC", label: "Basic", calc: "FIXED", value: toMoneyString(basic), amount: toMoneyString(basic) },
  ]
  const earningAmounts: Money[] = [basic]

  for (const component of ordered) {
    if (component.kind !== "EARNING") continue
    const amount = resolveComponent(component, basic)
    earningAmounts.push(amount)
    earningLines.push(toLine(component, amount))
  }

  const grossFull = sum(earningAmounts)

  // ── 2. Loss of pay ───────────────────────────────────────────────────────
  // Absence and *unpaid* leave only. Charging paid leave would be a
  // straightforward underpayment, which is why the attendance summary splits
  // the two rather than reporting one `onLeave` figure.
  //
  // The denominator is calendarDays, not workingDays: a monthly salary covers
  // the whole month including its Fridays, so a day of unpaid leave costs
  // 1/31 of a month, not 1/22.
  //
  // A company that pays full salary whatever the attendance switches this off
  // (`PayrollSetting.deductLossOfPay`). The absent and unpaid figures are still
  // frozen into the breakdown below, so the payslip stays a true record.
  const deductLossOfPay = input.deductLossOfPay ?? true
  const lopDays = deductLossOfPay ? dec(input.absent + input.onUnpaidLeave) : dec(0)
  const calendarDays = dec(input.calendarDays)
  const payableDays = calendarDays.minus(lopDays)

  // ── 3. Pro-rate the earnings side ────────────────────────────────────────
  const grossEarned = prorate(grossFull, payableDays, calendarDays)

  // ── 4. Deductions at a full month ────────────────────────────────────────
  // Deliberately *not* pro-rated, and percentages use full basic. A provident
  // fund contribution is defined on the salary, so pro-rating it would mean
  // somebody who took three days of unpaid leave quietly contributes less to
  // their own retirement. A policy choice, not arithmetic.
  const deductionLines: PayslipLine[] = []
  const deductionAmounts: Money[] = []

  for (const component of ordered) {
    if (component.kind !== "DEDUCTION") continue
    const amount = resolveComponent(component, basic)
    deductionAmounts.push(amount)
    deductionLines.push(toLine(component, amount))
  }

  // ── 5. Adjustments ───────────────────────────────────────────────────────
  // Earning adjustments land *after* pro-ration: a festival bonus is a bonus
  // for the festival, not for attendance, so an illness in March must not
  // reduce the Eid bonus.
  const adjustmentLines: PayslipLine[] = []
  const earningAdjustments: Money[] = []

  for (const adjustment of input.adjustments) {
    const amount = round2(adjustment.amount)
    if (adjustment.kind === "EARNING") earningAdjustments.push(amount)
    else deductionAmounts.push(amount)
    adjustmentLines.push(toAdjustmentLine(adjustment))
  }

  // ── 6. Totals ────────────────────────────────────────────────────────────
  const grossPay = sum([grossEarned, ...earningAdjustments])
  const totalDeductions = sum(deductionAmounts)
  // Returned negative rather than clamped when fixed deductions outrun a
  // heavily-LOP month. The caller rejects it (preflight blocker 5). Clamping
  // would hide a real data error — a percentage entered as 50 instead of 5 —
  // while quietly not deducting.
  const netPay = grossPay.minus(totalDeductions)

  // ── 7. Reimbursements ────────────────────────────────────────────────────
  // Outside grossPay on purpose: a reimbursement returns money the employee
  // already spent. Not wages, so not pro-rated by attendance, not in the §119
  // leave-pay base, not in the §2(10) gratuity base, and not taxable if a tax
  // engine ever arrives. Folding it into gross is arithmetically invisible
  // today and quietly wrong in every phase after.
  const reimbursements = sum(input.reimbursements.map((claim) => round2(claim.amount)))
  const netPayable = netPay.plus(reimbursements)

  // The earnings lines carry full-month figures, but `grossPay` is pro-rated,
  // so the two only reconcile once pro-ration is represented as a line of its
  // own. Without it the document shows earnings summing to 80,000 above a
  // gross of 72,258.06 and invites exactly one question.
  if (!grossEarned.equals(grossFull)) {
    earningLines.push({
      code: "LOP_ADJUSTMENT",
      label: `Loss of pay (${lopDays.toFixed(2)} of ${input.calendarDays} days)`,
      calc: "FIXED",
      value: toMoneyString(grossEarned.minus(grossFull)),
      amount: toMoneyString(grossEarned.minus(grossFull)),
    })
  }

  return {
    calendarDays: input.calendarDays,
    lopDays,
    payableDays,
    basic,
    grossFull,
    grossPay,
    totalDeductions,
    netPay,
    reimbursements,
    netPayable,
    breakdown: {
      earnings: earningLines,
      deductions: deductionLines,
      adjustments: adjustmentLines,
      reimbursements: input.reimbursements.map((claim) => ({
        claimId: claim.claimId,
        category: claim.category,
        expenseDate: claim.expenseDate,
        spentCurrency: claim.spentCurrency,
        spentAmount: toMoneyString(claim.spentAmount),
        fxRateToBdt: claim.fxRateToBdt.toFixed(6),
        amount: toMoneyString(claim.amount),
      })),
      attendance: {
        calendarDays: input.calendarDays,
        workingDays: input.workingDays,
        present: input.present,
        absent: input.absent,
        onPaidLeave: input.onPaidLeave,
        onUnpaidLeave: input.onUnpaidLeave,
        lopDays: lopDays.toNumber(),
        payableDays: payableDays.toNumber(),
      },
    },
  }
}
