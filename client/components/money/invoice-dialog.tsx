"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { createInvoice, updateInvoice, type InvoiceInput } from "@/lib/api/invoice"
import { listVatCodes } from "@/lib/api/vatCode"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, DealMoneyInvoice, Invoice, VatCode } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { DialogActions, Field, FormError, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function lineInvoiced(line: CustomerPo["lines"][number]): number {
  return line.invoiceLines.reduce((s, il) => s + Number(il.amount), 0)
}

interface LineDraft {
  poLineId: string
  description: string
  /** Left to invoice on this PO line, at the moment the dialog opened. Blank
   *  in edit mode — see the note on `invoice` below. */
  remaining: string
  vatCodeId: string
  amount: string
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
      return invoice.lines.map((l) => ({ poLineId: l.poLineId, description: l.description, remaining: "", vatCodeId: l.vatCodeId, amount: l.amount }))
    }
    return (po?.lines ?? [])
      .filter((l) => Number(l.amount) - lineInvoiced(l) > 0.004)
      .map((l) => ({
        poLineId: l.id,
        description: l.description,
        remaining: (Number(l.amount) - lineInvoiced(l)).toFixed(2),
        vatCodeId: l.vatCodeId,
        amount: "",
      }))
  })

  const update = (poLineId: string, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l) => (l.poLineId === poLineId ? { ...l, ...patch } : l)))

  const rateOf = (id: string) => Number(codes.find((c) => c.id === id)?.ratePercent ?? 0)
  const filled = lines.filter((l) => Number(l.amount) > 0)
  const net = filled.reduce((s, l) => s + Number(l.amount), 0)
  const vat = filled.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * rateOf(l.vatCodeId)) / 100, 0)

  const canSubmit = Boolean(invoiceNumber.trim() && date && filled.length > 0)

  const save = useMutation({
    mutationFn: () => {
      const rest = {
        invoiceNumber: invoiceNumber.trim(),
        date,
        dueDate: dueDate || undefined,
        lines: filled.map((l) => ({ poLineId: l.poLineId, description: l.description.trim() || undefined, amount: l.amount, vatCodeId: l.vatCodeId })),
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
          <DialogDescription>Bill against what is left to invoice on this PO.</DialogDescription>
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
                {!invoice ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => all.map((l) => ({ ...l, amount: l.remaining || l.amount })))}>
                    Bill all that is left
                  </Button>
                ) : null}
              </div>
              {lines.map((line) => (
                <div key={line.poLineId} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                  <Input
                    aria-label={`${line.description} description`}
                    className="sm:col-span-5"
                    value={line.description}
                    onChange={(e) => update(line.poLineId, { description: e.target.value })}
                  />
                  <div className={`flex items-center text-[12px] sm:col-span-2 ${TONE.muted}`}>
                    Left {line.remaining ? formatMoney(line.remaining, "BDT") : "—"}
                  </div>
                  <Input
                    aria-label={`${line.description} amount`}
                    className="sm:col-span-2"
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.amount}
                    onChange={(e) => update(line.poLineId, { amount: e.target.value })}
                    placeholder="Amount"
                  />
                  <select
                    aria-label={`${line.description} VAT`}
                    className={`${SELECT} sm:col-span-3`}
                    value={line.vatCodeId}
                    onChange={(e) => update(line.poLineId, { vatCodeId: e.target.value })}
                  >
                    {codes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
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
