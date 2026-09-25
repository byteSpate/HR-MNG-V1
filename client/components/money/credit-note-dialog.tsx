"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { createCustomerCreditNote, type CustomerCreditNoteInput } from "@/lib/api/customerCreditNote"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerCreditNote, DealMoneyInvoice } from "@/lib/api/types"
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
}

/**
 * "Fix this invoice" — a customer credit note against one, already-known,
 * approved invoice. Moved out of
 * `components/accounting/customer-credit-note-page.tsx`'s `CreditNoteDialog`
 * (deal-money-simplify Task 20) with the same change every dialog in this
 * folder makes: **no invoice picker**. The invoice is the one whose "Fix
 * this invoice" button was clicked, so its lines and its own credit notes
 * (`invoice.creditNotes`, already on the Money section payload) are enough
 * to work out what is left to credit — no extra query.
 */
export function CreditNoteDialog({
  open,
  onOpenChange,
  invoice,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: DealMoneyInvoice
  onSaved: (note: CustomerCreditNote) => void
}) {
  const { accessToken } = useSession()
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState("")
  const [picked, setPicked] = useState<Record<string, PickedLine>>({})
  const [error, setError] = useState<string | null>(null)

  // Left to credit counts every credit note already on this line, draft or
  // approved, the same cap the server keeps — mirrors the page this was
  // moved from (`existingNotes`), scoped here to one invoice's own notes.
  const alreadyCredited = (invoiceLineId: string): number =>
    invoice.creditNotes
      .flatMap((n) => n.lines)
      .filter((l) => l.invoiceLineId === invoiceLineId)
      .reduce((s, l) => s + Number(l.amount), 0)

  const total = Object.values(picked).reduce((s, l) => s + (Number(l.amount) || 0), 0)

  const canSubmit =
    Boolean(date && reason.trim()) &&
    Object.keys(picked).length > 0 &&
    Object.entries(picked).every(([lineId, l]) => {
      const line = invoice.lines.find((il) => il.id === lineId)
      const left = line ? Number(line.amount) - alreadyCredited(lineId) : 0
      return Number(l.amount) > 0 && Number(l.amount) <= left
    })

  const save = useMutation({
    mutationFn: (input: CustomerCreditNoteInput) => createCustomerCreditNote(accessToken!, input),
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
          <DialogTitle>Fix invoice {invoice.invoiceNumber}</DialogTitle>
          <DialogDescription>Choose the lines being reduced. VAT is worked out by the server.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <Field label="Date" htmlFor="ccn-date">
            <Input id="ccn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label="Reason" htmlFor="ccn-reason" hint="Required. Kept on record with the entry.">
            <Textarea id="ccn-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the customer is being credited" />
          </Field>

          <section className="space-y-2">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines being reduced</h3>
            {invoice.lines.map((line) => {
              const left = Number(line.amount) - alreadyCredited(line.id)
              const on = line.id in picked
              const rate = Number(line.amount) > 0 ? Number(line.vatAmount) / Number(line.amount) : 0
              const previewVat = on ? (Number(picked[line.id].amount) || 0) * rate : 0
              return (
                <div key={line.id} className="space-y-2 rounded-md border border-[#E4E9EF] px-3 py-2">
                  <CheckboxField
                    label={`${line.description}, ${formatMoney(left.toFixed(2), "BDT")} left to credit`}
                    checked={on}
                    disabled={left <= 0}
                    onChange={(next) =>
                      setPicked((all) => {
                        const copy = { ...all }
                        if (next) copy[line.id] = { amount: left.toFixed(2) }
                        else delete copy[line.id]
                        return copy
                      })
                    }
                  />
                  {on ? (
                    <div className="pl-6">
                      <Field label="Amount (BDT)" htmlFor={`ccn-amt-${line.id}`} hint={`Preview VAT ${formatMoney(previewVat.toFixed(2), "BDT")}, worked out again by the server.`}>
                        <Input
                          id={`ccn-amt-${line.id}`}
                          type="number"
                          min={0}
                          max={left}
                          step="0.01"
                          value={picked[line.id].amount}
                          onChange={(e) => setPicked((all) => ({ ...all, [line.id]: { amount: e.target.value } }))}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              )
            })}
            <p className="text-right text-[12.5px] font-bold tabular-nums">Credit {formatMoney(total.toFixed(2), "BDT")} before VAT</p>
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
                invoiceId: invoice.id,
                date,
                reason: reason.trim(),
                lines: Object.entries(picked).map(([invoiceLineId, l]) => ({ invoiceLineId, amount: l.amount })),
              })
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
