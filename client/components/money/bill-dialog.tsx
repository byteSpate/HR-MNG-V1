"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { RiAddLine, RiDeleteBinLine } from "@remixicon/react"

import { createSupplierBill, updateSupplierBill, type SupplierBillInput, type SupplierBillLineInput } from "@/lib/api/supplierBill"
import { listSuppliers } from "@/lib/api/supplier"
import { listVatCodes } from "@/lib/api/vatCode"
import { useSession } from "@/lib/auth/session-context"
import type { DealMoneyProductLine, DealMoneySupplierBill, SupplierBill } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { DialogActions, Field, FormError, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface LineDraft {
  description: string
  kind: "GOODS" | "SERVICE"
  amount: string
  vatCodeId: string
}

function blankLine(firstVatCodeId: string): LineDraft {
  return { description: "", kind: "GOODS", amount: "", vatCodeId: firstVatCodeId }
}

/** One draft line per product line from this supplier, description = product
 *  and model. Finance types the real amount; nothing is guessed from the
 *  product line, which carries no price. One blank line when there is no
 *  match, same as the dialog this replaced defaulted to. */
function seedLines(supplierId: string, productLines: DealMoneyProductLine[], firstVatCodeId: string): LineDraft[] {
  const matching = productLines.filter((pl) => pl.supplier?.id === supplierId)
  if (matching.length === 0) return [blankLine(firstVatCodeId)]
  return matching.map((pl) => ({
    description: [pl.product, pl.model].filter(Boolean).join(" "),
    kind: "GOODS",
    amount: "",
    vatCodeId: firstVatCodeId,
  }))
}

/**
 * "Add supplier bill" and "Edit" — creates or edits one bill on this deal.
 * Moved out of `components/accounting/supplier-bill-page.tsx`'s
 * `SupplierBillDialog` (deal-money-simplify Task 21) with the change every
 * dialog in this folder makes: **no deal picker** — `opportunityId` is fixed
 * to this deal, not chosen per line (Task 12 already moved it off the line).
 *
 * Creating adds one step ahead of the bill form: choosing the supplier
 * (design doc, "Add supplier bill on the deal page lists the suppliers from
 * the product lines first, and copies that supplier's lines into the bill").
 * No separate `supplier-picker.tsx` is built for this — that filename is
 * reserved for Task 24's shared, reusable picker for the Sales Hub product
 * line form, a different context. This is a small, task-scoped chooser
 * living in this file: the deal's product-line suppliers as buttons, then
 * "Another supplier" revealing a plain dropdown of every active supplier.
 * Editing skips this step — a bill cannot change supplier once drafted.
 */
export function BillDialog({
  open,
  onOpenChange,
  opportunityId,
  productLines,
  bill,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  opportunityId: string
  /** This deal's product lines, for seeding a new bill's lines and offering
   *  suppliers first. Unused to edit. */
  productLines: DealMoneyProductLine[]
  bill?: DealMoneySupplierBill
  onSaved: (bill: SupplierBill) => void
}) {
  const { accessToken } = useSession()
  const [error, setError] = useState<string | null>(null)

  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => listSuppliers(accessToken!),
    enabled: Boolean(accessToken) && open,
  })
  const vatCodes = useQuery({
    queryKey: ["vat-codes"],
    queryFn: () => listVatCodes(accessToken!),
    enabled: Boolean(accessToken) && open,
  })
  const codes = vatCodes.data ?? []
  const activeSuppliers = (suppliers.data ?? []).filter((s) => s.isActive || s.id === bill?.supplierId)

  const [supplierId, setSupplierId] = useState<string | null>(bill?.supplierId ?? null)
  const [showOtherSupplier, setShowOtherSupplier] = useState(false)
  const [billNumber, setBillNumber] = useState(bill?.billNumber ?? "")
  const [date, setDate] = useState(bill ? bill.date.slice(0, 10) : today())
  const [dueDate, setDueDate] = useState(bill ? bill.dueDate.slice(0, 10) : "")
  const [currency, setCurrency] = useState<"BDT" | "USD">(bill?.currency ?? "BDT")
  const [lines, setLines] = useState<LineDraft[]>(() =>
    bill
      ? bill.lines.map((l) => ({
          description: l.description,
          kind: l.kind,
          amount: bill.currency === "USD" && l.sourceAmount ? l.sourceAmount : l.amount,
          vatCodeId: l.vatCodeId,
        }))
      : []
  )

  // Suppliers already on this deal's product lines, deduped — offered ahead
  // of the full supplier list.
  const productLineSuppliers = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const pl of productLines) {
      if (pl.supplier) map.set(pl.supplier.id, pl.supplier)
    }
    return [...map.values()]
  }, [productLines])

  const chooseSupplier = (id: string) => {
    const supplier = (suppliers.data ?? []).find((s) => s.id === id)
    setSupplierId(id)
    if (supplier) setDueDate(addDays(date, supplier.paymentDays))
    setLines(seedLines(id, productLines, codes[0]?.id ?? ""))
  }

  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const rateOf = (id: string) => Number(codes.find((c) => c.id === (id || codes[0]?.id))?.ratePercent ?? 0)
  const net = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const vat = lines.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * rateOf(l.vatCodeId)) / 100, 0)

  const linesComplete = lines.every((l) => l.description.trim() && Number(l.amount) > 0 && (l.vatCodeId || codes[0]))
  const canSubmit = Boolean(supplierId && billNumber.trim() && date && dueDate && lines.length > 0 && linesComplete)

  const save = useMutation({
    mutationFn: () => {
      const input: SupplierBillInput = {
        supplierId: supplierId!,
        billNumber: billNumber.trim(),
        date,
        dueDate,
        currency,
        opportunityId,
        lines: lines.map<SupplierBillLineInput>((l) => ({
          description: l.description.trim(),
          kind: l.kind,
          // For a USD bill the server converts sourceAmount at the bill-date
          // rate and stores the taka figure; amount is sent only to pass the
          // schema and is replaced.
          amount: l.amount,
          ...(currency === "USD" ? { sourceAmount: l.amount } : {}),
          vatCodeId: l.vatCodeId || codes[0]?.id || "",
        })),
      }
      return bill ? updateSupplierBill(accessToken!, bill.id, input) : createSupplierBill(accessToken!, input)
    },
    onSuccess: (saved) => {
      setError(null)
      onSaved(saved)
    },
    onError: (err) => setError(toMessage(err)),
  })

  const supplierName = bill?.supplier.name ?? (suppliers.data ?? []).find((s) => s.id === supplierId)?.name ?? ""

  // Step 1: choose the supplier. Skipped entirely when editing.
  if (!bill && !supplierId) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add supplier bill</DialogTitle>
            <DialogDescription>Which supplier is this bill from?</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {productLineSuppliers.length > 0 ? (
              <div className="space-y-1.5">
                <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>On this deal</h3>
                <div className="flex flex-wrap gap-1.5">
                  {productLineSuppliers.map((s) => (
                    <Button
                      key={s.id}
                      type="button"
                      variant="outline"
                      onClick={() => chooseSupplier(s.id)}
                      className="h-9 rounded-md border-[#E4E9EF] text-[12.5px] font-semibold"
                    >
                      {s.name}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {!showOtherSupplier ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowOtherSupplier(true)}>
                Another supplier
              </Button>
            ) : (
              <Field label="Supplier" htmlFor="bill-other-supplier">
                <select
                  id="bill-other-supplier"
                  className={SELECT}
                  value=""
                  onChange={(e) => e.target.value && chooseSupplier(e.target.value)}
                >
                  <option value="">Choose a supplier</option>
                  {activeSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-auto rounded-md px-3.5 py-2 text-[12.5px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  // Step 2: the bill itself.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{bill ? `Edit bill ${bill.billNumber}` : `New bill from ${supplierName}`}</DialogTitle>
          <DialogDescription>Type the real bill number, amounts and VAT.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Supplier" htmlFor="bill-supplier">
              <div className="flex h-9 items-center rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 text-sm">{supplierName}</div>
            </Field>
            <Field label="Supplier's bill number" htmlFor="bill-number">
              <Input id="bill-number" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="INV-2201" />
            </Field>
            <Field label="Bill date" htmlFor="bill-date">
              <Input id="bill-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Due date" htmlFor="bill-due" hint="Filled from the supplier's payment days; change it if the bill says otherwise.">
              <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field
              label="Currency"
              htmlFor="bill-currency"
              hint={currency === "USD" ? "Converted to taka at the rate in force on the bill date, and frozen there." : undefined}
            >
              <select id="bill-currency" className={SELECT} value={currency} onChange={(e) => setCurrency(e.target.value as "BDT" | "USD")}>
                <option value="BDT">BDT</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>

          <section className="space-y-2">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines</h3>

            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                <div className="sm:col-span-12">
                  <Input
                    aria-label={`Line ${i + 1} description`}
                    value={line.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="Fortinet FortiGate 100F, 2 units"
                  />
                </div>
                <select
                  aria-label={`Line ${i + 1} kind`}
                  className={`${SELECT} sm:col-span-3`}
                  value={line.kind}
                  onChange={(e) => update(i, { kind: e.target.value as "GOODS" | "SERVICE" })}
                >
                  <option value="GOODS">Goods</option>
                  <option value="SERVICE">Service</option>
                </select>
                <Input
                  aria-label={`Line ${i + 1} amount`}
                  className="sm:col-span-3"
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                  placeholder={`Amount (${currency})`}
                />
                <select
                  aria-label={`Line ${i + 1} VAT`}
                  className={`${SELECT} sm:col-span-4`}
                  value={line.vatCodeId || codes[0]?.id || ""}
                  onChange={(e) => update(i, { vatCodeId: e.target.value })}
                >
                  {codes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove line ${i + 1}`}
                  className="sm:col-span-2"
                  disabled={lines.length === 1}
                  onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                >
                  <RiDeleteBinLine className="size-4" aria-hidden />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => [...all, blankLine(codes[0]?.id ?? "")])}>
              <RiAddLine className="size-4" aria-hidden /> Add line
            </Button>
          </section>

          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-[12.5px] tabular-nums">
            <span className={TONE.muted}>Net {formatMoney(net.toFixed(2), currency)}</span>
            <span className={TONE.muted}>VAT {formatMoney(vat.toFixed(2), currency)}</span>
            <span className="font-bold">Total {formatMoney((net + vat).toFixed(2), currency)}</span>
          </div>
          <p className={`text-right text-[11.5px] ${TONE.muted}`}>A preview. The saved figures are worked out by the server.</p>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={save.isPending}
            disabled={!canSubmit}
            submitLabel={bill ? "Save" : "Save as draft"}
            onCancel={() => onOpenChange(false)}
            onSubmit={() => save.mutate()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
