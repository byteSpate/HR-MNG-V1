"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { RiAddLine, RiDeleteBinLine } from "@remixicon/react"

import { listBillableOpportunities } from "@/lib/api/supplierBill"
import {
  createCustomerPo,
  prefillPoLines,
  updateCustomerPo,
  type CustomerPoInput,
} from "@/lib/api/customerPo"
import { listVatCodes } from "@/lib/api/vatCode"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, SaleLineKind, VatCode } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import {
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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

interface ScheduleDraft {
  plannedDate: string
  amount: string
  note: string
}

export function CustomerPoDialog({
  open,
  onOpenChange,
  opportunity,
  po,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed when given (the Sales Hub, or editing an existing PO). A deal
   *  picker is offered only when creating from the Finance page. */
  opportunity: { id: string; serial: string; name: string } | null
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
  const deals = useQuery({
    queryKey: ["billable-opportunities"],
    queryFn: () => listBillableOpportunities(accessToken!),
    enabled: Boolean(accessToken) && !opportunity && !po,
  })
  const codes = vatCodes.data ?? []

  const fixedDeal = opportunity ?? (po ? po.opportunity : null)
  const [opportunityId, setOpportunityId] = useState(fixedDeal?.id ?? "")
  const [customerPoNumber, setCustomerPoNumber] = useState(po?.customerPoNumber ?? "")
  const [date, setDate] = useState(po ? po.date.slice(0, 10) : today())
  const [invoiceTo, setInvoiceTo] = useState(po?.invoiceTo ?? "")
  const [lines, setLines] = useState<LineDraft[]>(
    po
      ? po.lines.map((l) => ({ description: l.description, kind: l.kind, quantity: l.quantity, unitPrice: l.unitPrice, vatCodeId: l.vatCodeId }))
      : [blankLine([])]
  )
  const [schedule, setSchedule] = useState<ScheduleDraft[]>(
    po ? po.schedule.map((s) => ({ plannedDate: s.plannedDate.slice(0, 10), amount: s.amount, note: s.note ?? "" })) : []
  )

  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const copyFromDeal = useMutation({
    mutationFn: () => prefillPoLines(accessToken!, opportunityId),
    onSuccess: (result) => {
      setLines(result.lines.map((p) => ({ description: p.description, kind: p.kind, quantity: p.quantity, unitPrice: p.unitPrice ?? "", vatCodeId: codes[0]?.id ?? "" })))
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
  const planned = schedule.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  const linesComplete = lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && Number(l.unitPrice) > 0 && (l.vatCodeId || codes[0]))
  const canSubmit = Boolean(opportunityId && customerPoNumber.trim() && date && lines.length > 0 && linesComplete)

  const submit = () =>
    save.mutate({
      opportunityId,
      customerPoNumber: customerPoNumber.trim(),
      date,
      invoiceTo: invoiceTo.trim() || undefined,
      ...(po ? {} : { trackDelivery: false }),
      lines: lines.map((l) => ({
        description: l.description.trim(),
        kind: l.kind,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatCodeId: l.vatCodeId || codes[0]?.id || "",
      })),
      schedule: schedule.map((r) => ({ plannedDate: r.plannedDate, amount: r.amount, note: r.note.trim() || undefined })),
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{po ? `Edit ${po.serial}` : "New customer PO"}</DialogTitle>
          <DialogDescription>
            What the customer ordered on this Won deal, and when the amounts are planned to be
            invoiced.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Deal" htmlFor="po-deal">
              {fixedDeal ? (
                <div className="flex h-9 items-center rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 text-sm">
                  {fixedDeal.serial} · {fixedDeal.name}
                </div>
              ) : (
                <select id="po-deal" className={SELECT} value={opportunityId} onChange={(e) => setOpportunityId(e.target.value)}>
                  <option value="">Choose a Won deal</option>
                  {(deals.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>{d.serial} · {d.accountName} · {d.name}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Customer PO number" htmlFor="po-number">
              <Input id="po-number" value={customerPoNumber} onChange={(e) => setCustomerPoNumber(e.target.value)} placeholder="PO-778" />
            </Field>
            <Field label="PO date" htmlFor="po-date">
              <Input id="po-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Invoice to" htmlFor="po-invoice-to" hint="Only when the customer wants a different company on the invoice">
              <Input id="po-invoice-to" value={invoiceTo} onChange={(e) => setInvoiceTo(e.target.value)} placeholder="Optional" />
            </Field>
          </div>

          {!fixedDeal && deals.isSuccess && (deals.data ?? []).length === 0 ? (
            <PanelAlert>There are no Won deals yet. A customer PO must belong to a Won deal.</PanelAlert>
          ) : null}

          <p className={`text-[12px] ${TONE.muted}`}>
            Delivery is not tracked on this PO: it counts as earned when invoiced. Tracked deliveries are not built yet.
          </p>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines</h3>
              {opportunityId ? (
                <Button type="button" variant="outline" size="sm" disabled={copyFromDeal.isPending} onClick={() => copyFromDeal.mutate()}>
                  {copyFromDeal.isPending ? "Copying…" : "Copy products from the deal"}
                </Button>
              ) : null}
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
                <select aria-label={`Line ${i + 1} kind`} className={`${SELECT} sm:col-span-2`} value={line.kind} onChange={(e) => update(i, { kind: e.target.value as SaleLineKind })}>
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
                <select aria-label={`Line ${i + 1} VAT`} className={`${SELECT} sm:col-span-2`} value={line.vatCodeId || codes[0]?.id || ""} onChange={(e) => update(i, { vatCodeId: e.target.value })}>
                  {codes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
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

          <section className="space-y-2">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Billing schedule</h3>

            {schedule.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                <Input
                  aria-label={`Planned date ${i + 1}`}
                  className="sm:col-span-3"
                  type="date"
                  value={row.plannedDate}
                  onChange={(e) => setSchedule((all) => all.map((r, j) => (j === i ? { ...r, plannedDate: e.target.value } : r)))}
                />
                <Input
                  aria-label={`Planned amount ${i + 1}`}
                  className="sm:col-span-3"
                  type="number"
                  min={0}
                  step="0.01"
                  value={row.amount}
                  onChange={(e) => setSchedule((all) => all.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
                  placeholder="Amount"
                />
                <Input
                  aria-label={`Planned note ${i + 1}`}
                  className="sm:col-span-5"
                  value={row.note}
                  onChange={(e) => setSchedule((all) => all.map((r, j) => (j === i ? { ...r, note: e.target.value } : r)))}
                  placeholder="Note (optional)"
                />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove planned row ${i + 1}`}
                  className="sm:col-span-1"
                  onClick={() => setSchedule((all) => all.filter((_, j) => j !== i))}
                >
                  <RiDeleteBinLine className="size-4" aria-hidden />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={() => setSchedule((all) => [...all, { plannedDate: today(), amount: "", note: "" }])}>
              <RiAddLine className="size-4" aria-hidden /> Add a planned invoice
            </Button>

            <p className={`text-[11.5px] ${TONE.muted}`}>A plan only. Nothing is posted from it.</p>
            {schedule.length > 0 ? (
              <p className={`text-right text-[12.5px] ${TONE.muted}`}>
                Planned: {formatMoney(planned.toFixed(2), "BDT")} of {formatMoney(net.toFixed(2), "BDT")} before VAT
              </p>
            ) : null}
          </section>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={save.isPending}
            disabled={!canSubmit}
            submitLabel={po ? "Save" : "Save as draft"}
            onCancel={() => onOpenChange(false)}
            onSubmit={submit}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
