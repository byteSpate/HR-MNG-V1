"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { overrideSettlement } from "@/lib/api/settlement"
import { useSession } from "@/lib/auth/session-context"
import type { Settlement } from "@/lib/api/types"
import { formatMoney, formatRate } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tag } from "@/components/dashboard/tag"
import {
  SETTLEMENT_STATUS_LABEL,
  SETTLEMENT_STATUS_TONE,
} from "@/components/payroll/payroll-shared"

/** A head with its working shown, so a disputed figure can be explained. */
function Head({
  label,
  amount,
  currency,
  working,
}: {
  label: string
  amount: string
  currency: Settlement["currency"]
  working?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#EEF1F5] py-2.5">
      <div>
        <div className="text-[13px]">{label}</div>
        {working ? <div className="mt-0.5 text-[11.5px] text-[#A5AFBE]">{working}</div> : null}
      </div>
      <div className="text-[13px] whitespace-nowrap">{formatMoney(amount, currency)}</div>
    </div>
  )
}

export function SettlementDetail({
  settlement,
  onClose,
  canApprove,
  canPay,
  canOverride,
  pending,
  onApprove,
  onReject,
  onPay,
  onChanged,
  onError,
}: {
  settlement: Settlement
  onClose: () => void
  canApprove: boolean
  canPay: boolean
  canOverride: boolean
  pending: boolean
  onApprove: () => void
  onReject: () => void
  onPay: () => void
  onChanged: (next: Settlement) => void
  onError: (err: unknown) => void
}) {
  const { accessToken } = useSession()
  const { breakdown, currency } = settlement
  const [overriding, setOverriding] = useState(false)
  const [gratuity, setGratuity] = useState(settlement.gratuity)
  const [deductions, setDeductions] = useState(settlement.outstandingDeductions)
  const [assetRecoveries, setAssetRecoveries] = useState(settlement.assetRecoveries)
  const [reason, setReason] = useState("")

  const overrideMutation = useMutation({
    mutationFn: () =>
      overrideSettlement(accessToken!, settlement.id, {
        gratuity: Number(gratuity),
        outstandingDeductions: Number(deductions),
        assetRecoveries: Number(assetRecoveries),
        reason: reason.trim(),
      }),
    onSuccess: (next) => {
      setOverriding(false)
      setReason("")
      onChanged(next)
    },
    onError,
  })

  return (
    <div className="space-y-5 rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-heading text-[18px] font-bold tracking-tight">
            {settlement.employee?.fullName ?? "Settlement"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-[#7A8698]">
            <Tag
              label={SETTLEMENT_STATUS_LABEL[settlement.status]}
              tone={SETTLEMENT_STATUS_TONE[settlement.status]}
            />
            <span>{settlement.settlementNo}</span>
            <span>· {breakdown.exitLabel}</span>
          </div>
        </div>
        <Button variant="link" className="h-auto p-0 text-[12.5px] font-semibold underline" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Last working day", breakdown.lastWorkingDay],
          ["Service", `${breakdown.serviceYears} years`],
          ["Completed years", String(breakdown.completedYears)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-[11.5px] font-bold tracking-wide text-[#7A8698] uppercase">
              {label}
            </div>
            <div className="mt-0.5 text-[15px] font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="text-[11.5px] font-bold tracking-wide text-[#7A8698] uppercase">Heads</div>
        <div className="mt-1">
          <Head
            label="Pending salary"
            amount={settlement.pendingSalary}
            currency={currency}
            working={`${breakdown.pendingSalary.daysEmployed} of ${breakdown.pendingSalary.calendarDays} days, ${breakdown.pendingSalary.payableDays} payable`}
          />
          {/* "30 days × 4 years on wages of 78,000", not a bare number. */}
          <Head
            label="Gratuity"
            amount={settlement.gratuity}
            currency={currency}
            working={breakdown.gratuity.reason}
          />
          <Head
            label="Notice pay"
            amount={settlement.noticePay}
            currency={currency}
            working={breakdown.notice.reason}
          />
          <Head
            label="Expense reimbursement"
            amount={settlement.expenseReimbursement}
            currency={currency}
            working={
              breakdown.claims.length > 0
                ? `${breakdown.claims.length} outstanding claim(s) swept onto this settlement`
                : "No outstanding claims"
            }
          />
          <Head
            label="Leave encashment"
            amount={settlement.leaveEncashment}
            currency={currency}
            working="Not computed this phase"
          />
          <Head
            label="Outstanding deductions"
            amount={settlement.outstandingDeductions}
            currency={currency}
          />
          <Head
            label="Asset recoveries"
            amount={settlement.assetRecoveries}
            currency={currency}
            working="Lost or damaged assets deducted from the final amount"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md bg-[#F5F7FA] px-4 py-3.5">
        <div className="text-[11.5px] font-bold tracking-wide text-[#7A8698] uppercase">
          Final amount
        </div>
        <div className="font-heading text-[20px] font-bold">
          {formatMoney(settlement.finalAmount, currency)}
        </div>
      </div>

      {currency !== "BDT" ? (
        <div className="rounded-md border border-[#E4E9EF] px-4 py-3 text-[12.5px] text-[#7A8698]">
          Converted at 1 {currency} = {formatRate(settlement.fxRateToBdt)} BDT ·{" "}
          {formatMoney(settlement.finalAmountBdt, "BDT")}
        </div>
      ) : null}

      {settlement.rejectionNote ? (
        <div className="rounded-md border border-[#F0D9D9] bg-[#FDF6F6] px-4 py-3 text-[12.5px] text-[#B03A3A]">
          Sent back: {settlement.rejectionNote}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canOverride ? (
          <Button variant="outline" onClick={() => setOverriding((v) => !v)}>
            {overriding ? "Cancel override" : "Override a head"}
          </Button>
        ) : null}
        {canApprove ? (
          <>
            <Button onClick={onApprove} disabled={pending}>
              Approve
            </Button>
            <Button variant="outline" onClick={onReject} disabled={pending}>
              Send back
            </Button>
          </>
        ) : null}
        {canPay ? (
          <Button onClick={onPay} disabled={pending}>
            Mark as paid
          </Button>
        ) : null}
      </div>

      {overriding ? (
        <div className="space-y-3 rounded-md border border-[#E4E9EF] p-4">
          <div className="text-[13px] font-semibold">Override</div>
          <div className="text-[11.5px] text-[#7A8698]">
            Whether a dismissal forfeits gratuity is a legal judgement, not arithmetic. The computed
            figure is the ordinary reading; a human may overrule it, and the change is audited.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="ovr-gratuity" className="mb-1.5 text-xs font-bold">
                Gratuity
              </Label>
              <Input
                id="ovr-gratuity"
                type="number"
                min="0"
                step="0.01"
                value={gratuity}
                onChange={(e) => setGratuity(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ovr-deductions" className="mb-1.5 text-xs font-bold">
                Outstanding deductions
              </Label>
              <Input
                id="ovr-deductions"
                type="number"
                min="0"
                step="0.01"
                value={deductions}
                onChange={(e) => setDeductions(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ovr-asset-recoveries" className="mb-1.5 text-xs font-bold">
                Asset recoveries
              </Label>
              <Input
                id="ovr-asset-recoveries"
                type="number"
                min="0"
                step="0.01"
                value={assetRecoveries}
                onChange={(e) => setAssetRecoveries(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ovr-reason" className="mb-1.5 text-xs font-bold">
              Reason (required)
            </Label>
            <Input
              id="ovr-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why this figure differs from the computed one"
            />
          </div>
          <Button
            disabled={!reason.trim() || overrideMutation.isPending}
            onClick={() => overrideMutation.mutate()}
          >
            Save override
          </Button>
        </div>
      ) : null}
    </div>
  )
}
