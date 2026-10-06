"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { createReceipt, type ReceiptInput } from "@/lib/api/receipt"
import { useSession } from "@/lib/auth/session-context"
import type { DealMoneyInvoice, Receipt, ReceiptPaymentMethod } from "@/lib/api/types"
import { invoicePayments, payOneInvoice } from "@/lib/invoice-payments"
import { formatMoney } from "@/lib/money"
import { paymentMethodLabel, RECEIPT_PAYMENT_METHODS } from "@/lib/receipt-method"
import { fromPaisa, toPaisa } from "@/components/accounting/accounting-shared"
import { DialogActions, Field, FormError, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * What is still owed on one approved invoice — gross, less collected, less
 * approved credit notes. Mirrors `getInvoiceOutstanding`
 * (`server/src/modules/receivables/receivables.reports.ts:24`), worked out
 * client-side here for the picker below, the same figure the server sums
 * into the deal's `numbers.stillOwed`.
 *
 * Exported so `PaidPart` can hide "Record payment received" when no
 * approved invoice on the deal has money still owed, the same way
 * `BoughtPart` uses `billStillOwed` for "Pay supplier".
 */
export function invoiceStillOwed(inv: DealMoneyInvoice): number {
  return Number(invoicePayments(inv).balance)
}

/**
 * "Record payment received" — a receipt against this deal's own approved,
 * still-owed invoices. Moved out of
 * `components/accounting/receipt-page.tsx`'s `ReceiptDialog`
 * (deal-money-simplify Task 20) and much simpler than it: **no customer
 * picker** (the deal has one customer already), and **no advance /
 * opening-balance matching** — both removed in this redesign (design doc,
 * "Removed"; "No advances", "The documents", "Rules"). The invoice picker
 * only ever lists this deal's own approved invoices with something still
 * owed.
 */
export function ReceiptDialog({
  open,
  onOpenChange,
  opportunityId,
  invoices,
  onlyInvoiceId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunityId: string
  invoices: DealMoneyInvoice[]
  /** Set when Finance opens this from one invoice's own row. Everything
   *  received then goes to that invoice, so nothing is typed twice. */
  onlyInvoiceId?: string
  onSaved: (receipt: Receipt) => void
}) {
  const { accessToken } = useSession()
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [paymentMethod, setPaymentMethod] = useState<ReceiptPaymentMethod | "">("")
  const [bankName, setBankName] = useState("")
  const [taxOpen, setTaxOpen] = useState(false)
  const [vdsAmount, setVdsAmount] = useState("")
  const [vdsCertificateRef, setVdsCertificateRef] = useState("")
  const [vdsCertificateDate, setVdsCertificateDate] = useState("")
  const [aitAmount, setAitAmount] = useState("")
  const [aitCertificateRef, setAitCertificateRef] = useState("")
  const [aitCertificateDate, setAitCertificateDate] = useState("")
  const [allocated, setAllocated] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const owing = invoices.filter(
    (inv) => inv.status === "APPROVED" && invoiceStillOwed(inv) > 0.004 && (!onlyInvoiceId || inv.id === onlyInvoiceId)
  )

  const settledTotal = (Number(amount) || 0) + (Number(vdsAmount) || 0) + (Number(aitAmount) || 0)

  // From one invoice's row, everything received is settled on that invoice.
  const only = onlyInvoiceId ? owing[0] : undefined
  const paisaOf = (v: string) => (Number.isNaN(toPaisa(v)) ? 0 : toPaisa(v))
  const settledText = fromPaisa(paisaOf(amount) + paisaOf(vdsAmount) + paisaOf(aitAmount))
  const one = only ? payOneInvoice(settledText, invoicePayments(only).balance) : null
  const effectiveAllocated: Record<string, string> = only
    ? Number(one!.amount) > 0 ? { [only.id]: one!.amount } : {}
    : allocated

  const allocatedTotal = Object.values(effectiveAllocated).reduce((s, v) => s + (Number(v) || 0), 0)
  // Exactly, not "at most" — the server refuses a receipt with money left
  // over (an advance, removed) or allocated past what it settles.
  const matches = Math.abs(settledTotal - allocatedTotal) < 0.005

  const canSubmit = Boolean(date && paymentMethod && Number(amount) > 0 && allocatedTotal > 0 && matches && !one?.tooMuch)

  const save = useMutation({
    mutationFn: (input: ReceiptInput) => createReceipt(accessToken!, input),
    onSuccess: (saved) => {
      setError(null)
      onSaved(saved)
    },
    onError: (err) => setError(toMessage(err)),
  })

  const submit = () => {
    if (!paymentMethod) return
    const allocations = Object.entries(effectiveAllocated)
      .filter(([, v]) => Number(v) > 0)
      .map(([invoiceId, v]) => ({ invoiceId, amount: v }))
    save.mutate({
      opportunityId,
      date,
      amount,
      reference: reference.trim() || undefined,
      paymentMethod,
      bankName: bankName.trim() || undefined,
      vdsAmount: vdsAmount || undefined,
      vdsCertificateRef: vdsCertificateRef.trim() || undefined,
      vdsCertificateDate: vdsCertificateDate || undefined,
      aitAmount: aitAmount || undefined,
      aitCertificateRef: aitCertificateRef.trim() || undefined,
      aitCertificateDate: aitCertificateDate || undefined,
      allocations,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Record payment received</DialogTitle>
          <DialogDescription>Money the customer paid on this Opportunity, and which invoices it settles.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <PanelNotice>One payment for two Opportunities? Record it once on each Opportunity.</PanelNotice>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" htmlFor="rcpt-date">
              <Input id="rcpt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="How was it paid?" htmlFor="rcpt-method">
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod((v as ReceiptPaymentMethod | null) ?? "")}>
                <SelectTrigger id="rcpt-method" className="w-full">
                  <SelectValue>{() => (paymentMethod ? paymentMethodLabel(paymentMethod) : "Pick one")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {RECEIPT_PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {paymentMethodLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Amount received (BDT)" htmlFor="rcpt-amount">
              <Input id="rcpt-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Reference" htmlFor="rcpt-reference">
              <Input id="rcpt-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="TT-4471" />
            </Field>
            <Field label="Bank name" htmlFor="rcpt-bank" hint="Leave this empty for cash.">
              <Input id="rcpt-bank" value={bankName} maxLength={100} onChange={(e) => setBankName(e.target.value)} />
            </Field>
          </div>

          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setTaxOpen((v) => !v)}>
              {taxOpen ? "Hide" : "Add"} tax the customer kept
            </Button>
          </div>

          {taxOpen ? (
            <section className="grid grid-cols-1 gap-3 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-2">
              <Field label="VAT withheld (BDT)" htmlFor="rcpt-vds">
                <Input id="rcpt-vds" type="number" min={0} step="0.01" value={vdsAmount} onChange={(e) => setVdsAmount(e.target.value)} />
              </Field>
              <div />
              <Field label="VDS certificate number" htmlFor="rcpt-vds-ref" hint="Add the certificate now or later.">
                <Input id="rcpt-vds-ref" value={vdsCertificateRef} onChange={(e) => setVdsCertificateRef(e.target.value)} />
              </Field>
              <Field label="VDS certificate date" htmlFor="rcpt-vds-date">
                <Input id="rcpt-vds-date" type="date" value={vdsCertificateDate} onChange={(e) => setVdsCertificateDate(e.target.value)} />
              </Field>
              <Field label="Income tax withheld (BDT)" htmlFor="rcpt-ait">
                <Input id="rcpt-ait" type="number" min={0} step="0.01" value={aitAmount} onChange={(e) => setAitAmount(e.target.value)} />
              </Field>
              <div />
              <Field label="AIT certificate number" htmlFor="rcpt-ait-ref">
                <Input id="rcpt-ait-ref" value={aitCertificateRef} onChange={(e) => setAitCertificateRef(e.target.value)} />
              </Field>
              <Field label="AIT certificate date" htmlFor="rcpt-ait-date">
                <Input id="rcpt-ait-date" type="date" value={aitCertificateDate} onChange={(e) => setAitCertificateDate(e.target.value)} />
              </Field>
            </section>
          ) : null}

          <section className="space-y-2">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>What it settles</h3>
            {owing.length === 0 ? (
              <p className={`text-[12.5px] ${TONE.muted}`}>No approved invoice on this Opportunity still owes money.</p>
            ) : (
              owing.map((inv) => {
                const left = invoiceStillOwed(inv)
                if (only) {
                  return (
                    <div key={inv.id} className="rounded-md border border-[#E4E9EF] p-3">
                      <div className="text-[13px] font-semibold">This payment is for invoice {inv.invoiceNumber}.</div>
                      <div className={`text-[11.5px] ${TONE.muted}`}>Still owed {formatMoney(left.toFixed(2), "BDT")}</div>
                      {one?.tooMuch ? (
                        <p role="status" className="mt-1 text-[12.5px] font-semibold text-[#8A5E0C]">
                          This is more than the invoice still owes. Lower the amount received.
                        </p>
                      ) : null}
                    </div>
                  )
                }
                return (
                  <div key={inv.id} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                    <div className="sm:col-span-6">
                      <div className="text-[13px] font-semibold">{inv.invoiceNumber}</div>
                      <div className={`text-[11.5px] ${TONE.muted}`}>Still owed {formatMoney(left.toFixed(2), "BDT")}</div>
                    </div>
                    <Input
                      aria-label={`${inv.invoiceNumber} amount`}
                      className="sm:col-span-3"
                      type="number"
                      min={0}
                      max={left}
                      step="0.01"
                      value={allocated[inv.id] ?? ""}
                      onChange={(e) => setAllocated((all) => ({ ...all, [inv.id]: e.target.value }))}
                      placeholder="Amount"
                    />
                  </div>
                )
              })
            )}
            <p className={`text-right text-[12.5px] ${TONE.muted}`}>
              Settles {formatMoney(allocatedTotal.toFixed(2), "BDT")} of {formatMoney(settledTotal.toFixed(2), "BDT")} (cash plus tax withheld).
            </p>
            {!matches && settledTotal > 0 ? (
              <p role="status" className="text-right text-[12.5px] font-semibold text-[#8A5E0C]">
                {settledTotal > allocatedTotal
                  ? `${formatMoney((settledTotal - allocatedTotal).toFixed(2), "BDT")} is not matched to an invoice. Raise the amount settled, lower the amount received, or add the tax the customer kept. Money that is not for an invoice cannot be saved.`
                  : `${formatMoney((allocatedTotal - settledTotal).toFixed(2), "BDT")} more is settled than was received. Lower the amount settled, or raise the amount received.`}
              </p>
            ) : null}
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
