"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { createInvoice, updateInvoice, type InvoiceInput } from "@/lib/api/invoice"
import { listVatCodes } from "@/lib/api/vatCode"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, DealMoneyInvoice, Invoice, VatCode, VatMethod } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { linesToBill } from "@/lib/po-rules"
import { DialogActions, Field, FormError, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { vatFieldsFor } from "@/lib/vat-payload"
import { VatChoice } from "./vat-choice"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface LineDraft {
  poLineId: string
  description: string
  vatCodeId: string
  vatMethod: VatMethod
  vatRatePercent: string
  amount: string
  /**
   * True once the person has changed the VAT control. While it is false the
   * line sends no VAT at all, so the server copies its PO line (spec
   * §1.6). An edit starts as true, so what is already saved on the invoice
   * is re-sent rather than silently replaced by the PO line's rate.
   */
  vatTouched: boolean
}

/**
 * Creates or edits one invoice, scoped to a single, already-known PO — moved
 * out of `components/accounting/invoice-page.tsx`'s `InvoiceDialog`
 * (deal-money-simplify Task 20) and changed in one way: **no PO picker**.
 * That page let a Finance user pick any invoiceable PO across every deal,
 * because it was not scoped to one deal. Here the row that was clicked is
 * the PO (or the invoice), so there is nothing to pick.
 *
 * `po` is required to create (its lines are what gets seeded into the
 * draft), and ignored when editing — an invoice cannot move to another PO,
 * and `invoice.lines` already carries what was saved. Editing also does not
 * show "left to invoice" per line, the same choice the page this was moved
 * from made: the edited invoice's own draft lines are already part of the
 * PO's own remaining figure, so showing it back would double count.
 */
export function InvoiceDialog({
  open,
  onOpenChange,
  po,
  invoice,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The fixed PO to bill against. Required to create; unused to edit. */
  po?: CustomerPo
  invoice?: DealMoneyInvoice
  onSaved: (invoice: Invoice) => void
}) {
  const { accessToken } = useSession()
  const [error, setError] = useState<string | null>(null)

  const vatCodes = useQuery({
    queryKey: ["vat-codes"],
    queryFn: () => listVatCodes(accessToken!),
    enabled: Boolean(accessToken),
  })
  const codes: VatCode[] = vatCodes.data ?? []

  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoiceNumber ?? "")
  const [date, setDate] = useState(invoice ? invoice.date.slice(0, 10) : today())
  const [dueDate, setDueDate] = useState(invoice ? invoice.dueDate.slice(0, 10) : "")
  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (invoice) {
      return invoice.lines.map((l) => ({
        poLineId: l.poLineId, description: l.description, vatCodeId: l.vatCodeId,
        vatMethod: l.vatMethod, vatRatePercent: l.vatRatePercent ?? "", vatTouched: true, amount: l.amount,
      }))
    }
    // One invoice bills the whole PO: every line, in full. The amounts are
    // filled in and cannot be changed. The server refuses anything else.
    const left = new Map((po ? linesToBill(po) : []).map((l) => [l.poLineId, l.amount]))
    return (po?.lines ?? [])
      .filter((l) => left.has(l.id))
      .map((l) => ({
        poLineId: l.id,
        description: l.description,
        vatCodeId: l.vatCodeId,
        vatMethod: l.vatMethod,
        vatRatePercent: l.vatMethod === "MANUAL" ? (l.vatRatePercent ?? "") : "",
        vatTouched: false,
        amount: left.get(l.id)!,
      }))
  })

  const update = (poLineId: string, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l) => (l.poLineId === poLineId ? { ...l, ...patch } : l)))

  const rateOf = (l: LineDraft) =>
    l.vatMethod === "MANUAL" ? Number(l.vatRatePercent) || 0 : Number(codes.find((c) => c.id === l.vatCodeId)?.ratePercent ?? 0)
  const filled = lines.filter((l) => Number(l.amount) > 0)
  const net = filled.reduce((s, l) => s + Number(l.amount), 0)
  const vat = filled.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * rateOf(l)) / 100, 0)

  const canSubmit = Boolean(invoiceNumber.trim() && date && filled.length > 0)

  const save = useMutation({
    mutationFn: () => {
      const rest = {
        invoiceNumber: invoiceNumber.trim(),
        date,
        dueDate: dueDate || undefined,
        lines: filled.map((l) => ({
          poLineId: l.poLineId,
          description: l.description.trim() || undefined,
          amount: l.amount,
          ...(l.vatTouched ? vatFieldsFor(l) : {}),
        })),
      }
      if (invoice) return updateInvoice(accessToken!, invoice.id, rest)
      const input: InvoiceInput = { poId: po!.id, ...rest }
      return createInvoice(accessToken!, input)
    },
    onSuccess: (saved) => {
      setError(null)
      onSaved(saved)
    },
    onError: (err) => setError(toMessage(err)),
  })

  const poLabel = invoice ? `${invoice.po.serial} · ${invoice.customer.legalName} · ${invoice.po.customerPoNumber}` : po ? `${po.serial} · ${po.customer.legalName} · ${po.customerPoNumber}` : ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{invoice ? `Edit invoice ${invoice.invoiceNumber}` : "Create invoice"}</DialogTitle>
          <DialogDescription>
            {invoice ? "An invoice bills the whole PO." : "This invoice bills the whole PO. Every line is filled in. A PO has one invoice."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer PO" htmlFor="inv-po">
              <div className="flex h-9 items-center rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 text-sm">{poLabel}</div>
            </Field>
            <Field label="Invoice number" htmlFor="inv-number" hint="Required. As printed on the real invoice.">
              <Input id="inv-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="As printed on the invoice" />
            </Field>
            <Field label="Date" htmlFor="inv-date">
              <Input id="inv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Due date" htmlFor="inv-due" hint="Leave blank to use the customer's payment days.">
              <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>

          {lines.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines</h3>
              </div>
              {lines.map((line) => (
                <div key={line.poLineId} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                  <Input
                    aria-label={`${line.description} description`}
                    className="sm:col-span-5"
                    value={line.description}
                    onChange={(e) => update(line.poLineId, { description: e.target.value })}
                  />
                  <Input
                    aria-label={`${line.description} amount`}
                    className="sm:col-span-4"
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.amount}
                    // A new invoice bills the line in full, so its amount is fixed.
                    readOnly={!invoice}
                    onChange={(e) => update(line.poLineId, { amount: e.target.value })}
                    placeholder="Amount"
                  />
                  <div className="sm:col-span-3">
                    <VatChoice
                      index={lines.indexOf(line)}
                      value={line}
                      codes={codes}
                      onChange={(patch) => update(line.poLineId, { ...patch, vatTouched: true })}
                    />
                  </div>
                </div>
              ))}

              <p className={`text-right text-[12.5px] ${TONE.muted}`}>
                Net {formatMoney(net.toFixed(2), "BDT")} · VAT {formatMoney(vat.toFixed(2), "BDT")} · Total{" "}
                {formatMoney((net + vat).toFixed(2), "BDT")} (worked out again by the server on save)
              </p>
            </section>
          ) : (
            <p className={`text-[12.5px] ${TONE.muted}`}>Nothing is left to invoice on this PO.</p>
          )}

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={save.isPending}
            disabled={!canSubmit}
            submitLabel={invoice ? "Save" : "Save as draft"}
            onCancel={() => onOpenChange(false)}
            onSubmit={() => save.mutate()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
