"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { createSupplierCreditNote, type SupplierCreditNoteInput } from "@/lib/api/supplierCreditNote"
import { useSession } from "@/lib/auth/session-context"
import type { DealMoneySupplierBill, SupplierCreditNote } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { CheckboxField, DialogActions, Field, FormError, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

interface PickedLine {
  amount: string
  vatAmount: string
}

/**
 * "Fix this bill" — a supplier credit note against one, already-known,
 * approved bill. Moved out of
 * `components/accounting/supplier-credit-note-page.tsx`'s `CreditNoteDialog`
 * (deal-money-simplify Task 21) with the same change every dialog in this
 * folder makes: **no bill picker** — the bill whose "Fix this bill" button
 * was clicked is already known, and its own lines and credit notes
 * (`bill.lines`, `bill.creditNotes`, already on the Money section payload)
 * are enough to work out what is left to credit — no extra query.
 *
 * A supplier credit note can never be sent back (design doc, "Approval";
 * `DealSendBackKind` excludes both credit-note kinds), so unlike
 * `BoughtPart`'s bill actions, nothing here needs a send-back path.
 */
export function BillCreditNoteDialog({
  open,
  onOpenChange,
  bill,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bill: DealMoneySupplierBill
  onSaved: (note: SupplierCreditNote) => void
}) {
  const { accessToken } = useSession()
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState("")
  const [picked, setPicked] = useState<Record<string, PickedLine>>({})
  const [error, setError] = useState<string | null>(null)

  // VAT is suggested in the same proportion as the bill line's own VAT
  // (moved from `supplier-credit-note-page.tsx`'s `vatFor`), and stays
  // editable.
  const vatFor = (lineId: string, amount: string): string => {
    const line = bill.lines.find((l) => l.id === lineId)
    if (!line || Number(line.amount) === 0) return "0"
    return ((Number(amount) || 0) * (Number(line.vatAmount) / Number(line.amount))).toFixed(2)
  }

  const total = Object.values(picked).reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.vatAmount) || 0), 0)

  const canSubmit =
    Boolean(date && reason.trim()) &&
    Object.keys(picked).length > 0 &&
    Object.values(picked).every((l) => Number(l.amount) > 0 && Number(l.vatAmount) >= 0)

  const save = useMutation({
    mutationFn: (input: SupplierCreditNoteInput) => createSupplierCreditNote(accessToken!, input),
    onSuccess: (saved) => {
      setError(null)
      onSaved(saved)
    },
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fix bill {bill.billNumber}</DialogTitle>
          <DialogDescription>Choose the lines being reduced. A reason is required.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <Field label="Date" htmlFor="scn-date">
            <Input id="scn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label="Reason" htmlFor="scn-reason" hint="Required. Kept on record with the entry.">
            <Textarea id="scn-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Two firewalls returned, faulty on arrival" />
          </Field>

          <section className="space-y-2">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines being reduced</h3>
            {bill.lines.map((line) => {
              const on = line.id in picked
              return (
                <div key={line.id} className="space-y-2 rounded-md border border-[#E4E9EF] px-3 py-2">
                  <CheckboxField
                    label={`${line.description} (${line.kind === "GOODS" ? "goods" : "service"}), ${formatMoney(line.amount, "BDT")} plus ${formatMoney(line.vatAmount, "BDT")} VAT`}
                    checked={on}
                    onChange={(next) =>
                      setPicked((all) => {
                        const copy = { ...all }
                        if (next) copy[line.id] = { amount: line.amount, vatAmount: line.vatAmount }
                        else delete copy[line.id]
                        return copy
                      })
                    }
                  />
                  {on ? (
                    <div className="grid grid-cols-2 gap-2 pl-6">
                      <Field label="Amount (BDT)" htmlFor={`scn-amt-${line.id}`}>
                        <Input
                          id={`scn-amt-${line.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={picked[line.id].amount}
                          onChange={(e) =>
                            setPicked((all) => ({ ...all, [line.id]: { amount: e.target.value, vatAmount: vatFor(line.id, e.target.value) } }))
                          }
                        />
                      </Field>
                      <Field label="VAT (BDT)" htmlFor={`scn-vat-${line.id}`}>
                        <Input
                          id={`scn-vat-${line.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={picked[line.id].vatAmount}
                          onChange={(e) => setPicked((all) => ({ ...all, [line.id]: { ...all[line.id], vatAmount: e.target.value } }))}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              )
            })}
            <p className="text-right text-[12.5px] font-bold tabular-nums">Credit {formatMoney(total.toFixed(2), "BDT")}</p>
          </section>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={save.isPending}
            disabled={!canSubmit}
            submitLabel="Save as draft"
            onCancel={() => onOpenChange(false)}
            onSubmit={() =>
              save.mutate({
                billId: bill.id,
                date,
                reason: reason.trim(),
                lines: Object.entries(picked).map(([billLineId, l]) => ({ billLineId, amount: l.amount, vatAmount: l.vatAmount })),
              })
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
