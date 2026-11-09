"use client"

import type { Payslip, PayslipLine } from "@/lib/api/types"
import { formatMoney, formatMonth, formatRate } from "@/lib/money"
import { Button } from "@/components/ui/button"

function LineRows({ lines, currency }: { lines: PayslipLine[]; currency: Payslip["currency"] }) {
  if (lines.length === 0) {
    return <div className="py-2 text-caption text-ink-muted">None</div>
  }
  return (
    <>
      {lines.map((line) => (
        <div
          key={line.code}
          className="flex items-baseline justify-between border-b border-surface-sunken py-2"
        >
          <div>
            <div className="text-body-sm">{line.label}</div>
            <div className="text-caption text-ink-muted">
              {line.calc === "PERCENT_OF_BASIC"
                ? `${line.value}% of basic`
                : line.calc === "ADJUSTMENT"
                  ? "Adjustment"
                  : "Fixed"}
            </div>
          </div>
          <div className="text-body-sm">{formatMoney(line.amount, currency)}</div>
        </div>
      ))}
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-caption font-bold tracking-wide text-ink-muted uppercase">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

export function PayslipDetail({ payslip, onClose }: { payslip: Payslip; onClose: () => void }) {
  const { breakdown, currency } = payslip
  const earningAdjustments = breakdown.adjustments.filter((a) => a.kind === "EARNING")
  const deductionAdjustments = breakdown.adjustments.filter((a) => a.kind === "DEDUCTION")

  return (
    <div className="space-y-5 rounded-md border border-line bg-white px-5.5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-heading text-title font-bold tracking-tight">
            {payslip.payrollRun
              ? formatMonth(payslip.payrollRun.month, payslip.payrollRun.year)
              : "Payslip"}
          </div>
          <div className="text-caption text-ink-muted">{payslip.payslipNo}</div>
        </div>
        <Button variant="link" className="h-auto p-0 text-caption font-semibold underline" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Calendar days", String(breakdown.attendance.calendarDays)],
          ["Payable days", String(breakdown.attendance.payableDays)],
          ["Loss of pay", String(breakdown.attendance.lopDays)],
          ["Paid leave", String(breakdown.attendance.onPaidLeave)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-caption font-bold tracking-wide text-ink-muted uppercase">
              {label}
            </div>
            <div className="mt-0.5 text-lead font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <Section title="Earnings">
        <LineRows lines={[...breakdown.earnings, ...earningAdjustments]} currency={currency} />
        <div className="flex justify-between pt-2 text-body-sm font-semibold">
          <span>Gross pay</span>
          <span>{formatMoney(payslip.grossPay, currency)}</span>
        </div>
      </Section>

      <Section title="Deductions">
        <LineRows lines={[...breakdown.deductions, ...deductionAdjustments]} currency={currency} />
        <div className="flex justify-between pt-2 text-body-sm font-semibold">
          <span>Total deductions</span>
          <span>−{formatMoney(payslip.totalDeductions, currency)}</span>
        </div>
      </Section>

      {/* Its own section, never folded into earnings: a reimbursement returns
          money already spent, and showing it as an earning misrepresents it
          as wages. */}
      {breakdown.reimbursements.length > 0 ? (
        <Section title="Reimbursements">
          {breakdown.reimbursements.map((claim) => (
            <div
              key={claim.claimId}
              className="flex items-baseline justify-between border-b border-surface-sunken py-2"
            >
              <div>
                <div className="text-body-sm">{claim.category}</div>
                <div className="text-caption text-ink-muted">
                  Spent {claim.expenseDate}
                  {claim.spentCurrency === currency
                    ? ""
                    : ` · ${formatMoney(claim.spentAmount, claim.spentCurrency)} at ${formatRate(claim.fxRateToBdt)}`}
                </div>
              </div>
              <div className="text-body-sm">{formatMoney(claim.amount, currency)}</div>
            </div>
          ))}
        </Section>
      ) : null}

      <div className="flex items-center justify-between rounded-md bg-surface-subtle px-4 py-3.5">
        <div>
          <div className="text-caption font-bold tracking-wide text-ink-muted uppercase">
            Net payable
          </div>
          <div className="text-caption text-ink-muted">
            Net pay {formatMoney(payslip.netPay, currency)} plus reimbursements{" "}
            {formatMoney(payslip.reimbursements, currency)}
          </div>
        </div>
        <div className="font-heading text-title font-bold">
          {formatMoney(payslip.netPayable, currency)}
        </div>
      </div>

      {/* For a non-BDT payslip, the frozen rate and the BDT equivalent —
          because that is the figure that actually reached the bank. */}
      {currency !== "BDT" ? (
        <div className="rounded-md border border-line px-4 py-3 text-caption text-ink-muted">
          Converted at the rate frozen for this payroll month: 1 {currency} ={" "}
          {formatRate(payslip.fxRateToBdt)} BDT. Net payable{" "}
          <strong className="text-ink-body">{formatMoney(payslip.netPayableBdt, "BDT")}</strong>,
          which is what the bank file pays.
        </div>
      ) : null}
    </div>
  )
}
