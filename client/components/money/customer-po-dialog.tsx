"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { RiAddLine, RiDeleteBinLine } from "@remixicon/react"

import { createCustomerPo, prefillPoLines, updateCustomerPo, type CustomerPoInput } from "@/lib/api/customerPo"
import { listVatCodes } from "@/lib/api/vatCode"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, SaleLineKind, VatCode } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { DialogActions, Field, FormError, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface LineDraft {
  description: string
  kind: SaleLineKind
  quantity: string
  unitPrice: string
  vatCodeId: string
}

function blankLine(vatCodes: VatCode[]): LineDraft {
  return { description: "", kind: "GOODS", quantity: "1", unitPrice: "", vatCodeId: vatCodes[0]?.id ?? "" }
}

function lineTotal(l: LineDraft): string | null {
  if (!l.quantity || !l.unitPrice) return null
  return (Number(l.quantity) * Number(l.unitPrice)).toFixed(2)
}

/**
 * Records or edits one customer PO. Moved here from
 * `components/accounting/customer-po-dialog.tsx` (deal-money-simplify Task
 * 19) and changed in two ways:
 *
 * - **No deal picker.** The old dialog offered one when `opportunity` was
 *   omitted, for the standalone Finance "New customer PO" button (any Won
 *   deal). This dialog only ever opens from inside one deal's Money section,
 *   so it takes `opportunityId` directly and there is nothing to pick.
 * - **No billing schedule.** The server dropped `CustomerPo.schedule`
 *   (Task 3) — it planned future invoice dates and amounts but posted
 *   nothing, and nobody used the plan for anything the app could check.
 *
 * Self-contained like the file it was moved from: its own queries and
 * mutations, no parent-page-local state. `onSaved` is the only way out with
 * a result; the caller decides what "saved" means for its own list.
 */
export function CustomerPoDialog({
  open,
  onOpenChange,
  opportunityId,
  po,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunityId: string
  po?: CustomerPo
  onSaved: (po: CustomerPo) => void
}) {
  const { accessToken } = useSession()
  const [error, setError] = useState<string | null>(null)

  const vatCodes = useQuery({
    queryKey: ["vat-codes"],
    queryFn: () => listVatCodes(accessToken!),
    enabled: Boolean(accessToken),
  })
  const codes = vatCodes.data ?? []

  const [customerPoNumber, setCustomerPoNumber] = useState(po?.customerPoNumber ?? "")
  const [date, setDate] = useState(po ? po.date.slice(0, 10) : today())
  const [invoiceTo, setInvoiceTo] = useState(po?.invoiceTo ?? "")
  const [lines, setLines] = useState<LineDraft[]>(
    po
      ? po.lines.map((l) => ({ description: l.description, kind: l.kind, quantity: l.quantity, unitPrice: l.unitPrice, vatCodeId: l.vatCodeId }))
      : [blankLine([])]
  )

  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const copyFromDeal = useMutation({
    mutationFn: () => prefillPoLines(accessToken!, opportunityId),
    onSuccess: (result) => {
      setLines(
        result.lines.map((p) => ({ description: p.description, kind: p.kind, quantity: p.quantity, unitPrice: p.unitPrice ?? "", vatCodeId: codes[0]?.id ?? "" }))
      )
    },
    onError: (err) => setError(toMessage(err)),
  })

  const save = useMutation({
    mutationFn: (input: CustomerPoInput) => (po ? updateCustomerPo(accessToken!, po.id, input) : createCustomerPo(accessToken!, input)),
    onSuccess: (saved) => {
      setError(null)
      onSaved(saved)
    },
    onError: (err) => setError(toMessage(err)),
  })

  const net = lines.reduce((s, l) => s + Number(lineTotal(l) ?? "0"), 0)

  const linesComplete = lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && Number(l.unitPrice) > 0 && (l.vatCodeId || codes[0]))
  const canSubmit = Boolean(customerPoNumber.trim() && date && lines.length > 0 && linesComplete)

  const submit = () =>
    save.mutate({
      opportunityId,
      customerPoNumber: customerPoNumber.trim(),
      date,
      invoiceTo: invoiceTo.trim() || undefined,
      lines: lines.map((l) => ({
        description: l.description.trim(),
        kind: l.kind,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatCodeId: l.vatCodeId || codes[0]?.id || "",
      })),
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{po ? `Edit ${po.serial}` : "Record customer PO"}</DialogTitle>
          <DialogDescription>What the customer ordered on this deal.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer PO number" htmlFor="po-number">
              <Input id="po-number" value={customerPoNumber} onChange={(e) => setCustomerPoNumber(e.target.value)} placeholder="PO-778" />
            </Field>
            <Field label="PO date" htmlFor="po-date">
              <Input id="po-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Invoice to" htmlFor="po-invoice-to" hint="Only when the customer wants a different company name on the invoice">
              <Input id="po-invoice-to" value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} placeholder="Optional" />
            </Field>
          </div>

          <p className={`text-[12px] ${TONE.muted}`}>
            This PO is counted as delivered when it is invoiced. There is no separate delivery tracking.
          </p>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines</h3>
              <Button type="button" variant="outline" size="sm" disabled={copyFromDeal.isPending} onClick={() => copyFromDeal.mutate()}>
                {copyFromDeal.isPending ? "Copying…" : "Copy products from the deal"}
              </Button>
            </div>

            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                <div className="sm:col-span-12">
                  <Input
                    aria-label={`Line ${i + 1} description`}
                    value={line.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="Fortinet FortiGate 100F"
                  />
                </div>
                <select
                  aria-label={`Line ${i + 1} kind`}
                  className={`${SELECT} sm:col-span-2`}
                  value={line.kind}
                  onChange={(e) => update(i, { kind: e.target.value as SaleLineKind })}
                >
                  <option value="GOODS">Goods</option>
                  <option value="SERVICE">Service</option>
                </select>
                <Input
                  aria-label={`Line ${i + 1} quantity`}
                  className="sm:col-span-2"
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.quantity}
                  onChange={(e) => update(i, { quantity: e.target.value })}
                  placeholder="Qty"
                />
                <Input
                  aria-label={`Line ${i + 1} unit price`}
                  className="sm:col-span-2"
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unitPrice}
                  onChange={(e) => update(i, { unitPrice: e.target.value })}
                  placeholder="Enter a unit price"
                  required
                />
                <select
                  aria-label={`Line ${i + 1} VAT`}
                  className={`${SELECT} sm:col-span-2`}
                  value={line.vatCodeId || codes[0]?.id || ""}
                  onChange={(e) => update(i, { vatCodeId: e.target.value })}
                >
                  {codes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <div className={`flex items-center text-[12.5px] sm:col-span-3 ${TONE.muted}`}>
                  {lineTotal(line) ? `Line total ${formatMoney(lineTotal(line)!, "BDT")}` : "Line total —"}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove line ${i + 1}`}
                  className="sm:col-span-1"
                  disabled={lines.length === 1}
                  onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                >
                  <RiDeleteBinLine className="size-4" aria-hidden />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => [...all, blankLine(codes)])}>
              <RiAddLine className="size-4" aria-hidden /> Add line
            </Button>

            <p className={`text-right text-[12.5px] font-bold ${TONE.muted}`}>Net {formatMoney(net.toFixed(2), "BDT")}</p>
          </section>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={save.isPending}
            disabled={!canSubmit}
            submitLabel={po ? "Save" : "Record PO"}
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
