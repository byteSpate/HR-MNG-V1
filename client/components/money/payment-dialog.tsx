"use client"

import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { createSupplierPayment, type SupplierPaymentInput } from "@/lib/api/supplierPayment"
import { useSession } from "@/lib/auth/session-context"
import type { DealMoneySupplierBill, SupplierPayment } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { DialogActions, Field, FormError, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * What is still owed on one approved bill — gross, less approved payments,
 * less approved credit notes. Mirrors `getBillOutstanding`
 * (`server/src/modules/supplierBill/supplierBill.reports.ts:19`), worked out
 * client-side here for the picker below, the same way `ReceiptDialog` mirrors
 * `getInvoiceOutstanding` for the customer side.
 *
 * Exported so `BoughtPart` can decide whether "Pay supplier" has anything to
 * do at all (a draft bill is never payable, so a supplier whose only bill on
 * this deal is still waiting for approval must not appear as payable).
 */
export function billStillOwed(bill: DealMoneySupplierBill): number {
  const gross = bill.lines.reduce((s, l) => s + Number(l.amount) + Number(l.vatAmount), 0)
  const paid = bill.allocations.reduce((s, a) => s + Number(a.amount), 0)
  const credited = bill.creditNotes
    .filter((cn) => cn.status === "APPROVED")
    .reduce((s, cn) => s + cn.lines.reduce((s2, l) => s2 + Number(l.amount) + Number(l.vatAmount), 0), 0)
  return gross - paid - credited
}

/**
 * "Pay supplier" — a payment against this deal's own approved, still-owed
 * bills from one supplier. Moved out of
 * `components/accounting/supplier-payment-page.tsx`'s `PaymentDialog`
 * (deal-money-simplify Task 21) and much simpler than it: **no advance /
 * opening-balance matching** — removed in this redesign (design doc,
 * "Removed"; "No advances"). What is put against bills must equal the
 * payment amount exactly; there is no draft/approve step either (Global
 * Constraint: "Receipts and supplier payments count when saved").
 */
export function PaymentDialog({
  open,
  onOpenChange,
  opportunityId,
  bills,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunityId: string
  /** This deal's supplier bills, any status — filtered here to the chosen
   *  supplier's approved, still-owed ones. */
  bills: DealMoneySupplierBill[]
  onSaved: (payment: SupplierPayment) => void
}) {
  const { accessToken } = useSession()
  const [supplierId, setSupplierId] = useState("")
  const [date, setDate] = useState(today())
  const [currency, setCurrency] = useState<"BDT" | "USD">("BDT")
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [allocated, setAllocated] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  // Only suppliers with something actually payable — an approved bill with
  // money still owed. A supplier whose only bill on this deal is still a
  // draft must not appear here: picking them would land on an always-empty
  // "nothing owed" state even though money is genuinely owed, just not yet
  // approved (review finding, Minor 1).
  const supplierOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const b of bills) {
      if (b.status === "APPROVED" && billStillOwed(b) > 0.004) map.set(b.supplierId, b.supplier)
    }
    return [...map.values()]
  }, [bills])

  // Open, approved bills for the chosen supplier with money still owed. A
  // bill can only be paid in the currency it was billed in (design doc,
  // "A US dollar bill is paid in US dollars only") — a taka payment offers
  // only taka bills, and a US dollar payment offers only US dollar bills.
  const candidates = bills
    .filter((b) => b.supplierId === supplierId && b.status === "APPROVED" && billStillOwed(b) > 0.004)
    .filter((b) => (currency === "BDT" ? b.currency === "BDT" : b.currency === "USD"))

  /** What is left on the bill, in the payment's currency. */
  const leftOn = (bill: DealMoneySupplierBill): number => {
    if (currency === "USD" && bill.fxRateToBdt) return Math.floor((billStillOwed(bill) / Number(bill.fxRateToBdt)) * 100) / 100
    return billStillOwed(bill)
  }

  const allocatedTotal = Object.values(allocated).reduce((s, v) => s + (Number(v) || 0), 0)
  // Exactly, not "at most" — no advance: the server refuses a payment with
  // money left over or allocated past what it settles.
  const matches = Math.abs((Number(amount) || 0) - allocatedTotal) < 0.005

  const canSubmit = Boolean(supplierId && date && Number(amount) > 0 && allocatedTotal > 0 && matches)

  const changeScope = (apply: () => void) => {
    apply()
    setAllocated({})
  }

  const save = useMutation({
    mutationFn: (input: SupplierPaymentInput) => createSupplierPayment(accessToken!, input),
    onSuccess: (saved) => {
      setError(null)
      onSaved(saved)
    },
    onError: (err) => setError(toMessage(err)),
  })

  const submit = () => {
    const allocations = Object.entries(allocated)
      .filter(([, v]) => Number(v) > 0)
      .map(([billId, v]) => ({ billId, amount: v }))
    save.mutate({
      opportunityId,
      supplierId,
      date,
      amount,
      currency,
      reference: reference.trim() || undefined,
      allocations,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pay supplier</DialogTitle>
          <DialogDescription>Pick the bills this pays. The amount must be put against bills in full.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Supplier" htmlFor="pay-supplier">
              <select id="pay-supplier" className={SELECT} value={supplierId} onChange={(e) => changeScope(() => setSupplierId(e.target.value))}>
                <option value="">Choose a supplier</option>
                {supplierOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Payment date" htmlFor="pay-date">
              <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field
              label="Currency"
              htmlFor="pay-currency"
              hint={currency === "USD" ? "A US dollar bill is paid in US dollars only. Any gap to the bill's own rate is posted as an exchange gain or loss." : undefined}
            >
              <select id="pay-currency" className={SELECT} value={currency} onChange={(e) => changeScope(() => setCurrency(e.target.value as "BDT" | "USD"))}>
                <option value="BDT">BDT</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label={`Amount paid (${currency})`} htmlFor="pay-amount">
              <Input id="pay-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Reference" htmlFor="pay-ref" hint="Cheque number, bank reference or transaction ID.">
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>

          <section className="space-y-2">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Bills this pays</h3>
            {!supplierId ? (
              <p className={`text-[12.5px] ${TONE.muted}`}>Choose a supplier to see what is still owed on this deal.</p>
            ) : candidates.length === 0 ? (
              <p className={`text-[12.5px] ${TONE.muted}`}>
                {currency === "USD"
                  ? "This supplier has no open USD bills on this deal."
                  : "This supplier has no open taka bills on this deal."}
              </p>
            ) : (
              candidates.map((bill) => (
                <div key={bill.id} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                  <div className="sm:col-span-7">
                    <div className="text-[13px] font-semibold">{bill.billNumber}</div>
                    <div className={`text-[11.5px] ${TONE.muted}`}>Still owed {formatMoney(leftOn(bill).toFixed(2), currency)}</div>
                  </div>
                  <Input
                    aria-label={`${bill.billNumber} amount`}
                    className="sm:col-span-5"
                    type="number"
                    min={0}
                    max={leftOn(bill)}
                    step="0.01"
                    value={allocated[bill.id] ?? ""}
                    onChange={(e) => setAllocated((all) => ({ ...all, [bill.id]: e.target.value }))}
                    placeholder="Amount"
                  />
                </div>
              ))
            )}
            <p className={`text-right text-[12.5px] ${TONE.muted}`}>
              Against bills {formatMoney(allocatedTotal.toFixed(2), currency)} of {formatMoney((Number(amount) || 0).toFixed(2), currency)} paid.
              {!matches ? " These must match. There is no advance: money not put against a bill cannot be saved." : ""}
            </p>
          </section>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions pending={save.isPending} disabled={!canSubmit} submitLabel="Save" onCancel={() => onOpenChange(false)} onSubmit={submit} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
