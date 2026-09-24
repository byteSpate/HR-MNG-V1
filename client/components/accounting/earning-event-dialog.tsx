"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { createEarningEvent } from "@/lib/api/earningEvent"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, CustomerPoLine } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { DialogActions, Field, FormError, TONE, toMessage } from "@/components/dashboard/record-kit"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** What is left to record against a tracked PO line, from the PO's own
 *  approved earning-event lines and posted monthly earnings (spec §2: a
 *  line's earnKind is fixed, so a DELIVERY line only ever carries quantity
 *  and an ACCEPTANCE line only ever carries amount). */
function lineRemaining(line: CustomerPoLine): number {
  if (line.earnKind === "DELIVERY") {
    return Number(line.quantity) - line.earningLines.reduce((s, el) => s + Number(el.quantity ?? 0), 0)
  }
  return Number(line.amount) - line.earningLines.reduce((s, el) => s + Number(el.amount), 0)
}

interface LineDraft {
  poLineId: string
  description: string
  unitPrice: string
  remaining: number
  value: string
}

export function EarningEventDialog({
  po,
  kind,
  open,
  onOpenChange,
  onSaved,
}: {
  po: CustomerPo
  kind: "DELIVERY" | "ACCEPTANCE"
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { accessToken } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState(today())
  const [evidenceRef, setEvidenceRef] = useState("")
  const [note, setNote] = useState("")
  const [lines, setLines] = useState<LineDraft[]>(
    po.lines
      .filter((l) => l.earnKind === kind)
      .map((l) => ({ poLineId: l.id, description: l.description, unitPrice: l.unitPrice, remaining: lineRemaining(l), value: "" }))
      .filter((l) => l.remaining > 0)
  )

  const update = (poLineId: string, value: string) =>
    setLines((all) => all.map((l) => (l.poLineId === poLineId ? { ...l, value } : l)))

  const filled = lines.filter((l) => Number(l.value) > 0)

  const save = useMutation({
    mutationFn: () =>
      createEarningEvent(accessToken!, {
        poId: po.id,
        kind,
        date,
        evidenceRef: evidenceRef.trim(),
        note: note.trim() || undefined,
        lines: filled.map((l) => (kind === "DELIVERY" ? { poLineId: l.poLineId, quantity: l.value } : { poLineId: l.poLineId, amount: l.value })),
      }),
    onSuccess: () => {
      setError(null)
      onSaved()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const canSubmit = Boolean(evidenceRef.trim() && date && filled.length > 0)
  const evidenceLabel = kind === "DELIVERY" ? "Challan number" : "Acceptance note"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{kind === "DELIVERY" ? "Record delivery" : "Record acceptance"} · {po.serial}</DialogTitle>
          <DialogDescription>
            {kind === "DELIVERY"
              ? "What was delivered to the customer, and how much of the PO it covers."
              : "What the customer signed off, and how much of the PO it covers."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Date" htmlFor="ee-date">
              <Input id="ee-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={evidenceLabel} htmlFor="ee-ref">
              <Input id="ee-ref" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} placeholder={kind === "DELIVERY" ? "CH-118" : "AN-42"} />
            </Field>
          </div>

          <Field label="Note" htmlFor="ee-note" hint="Optional">
            <Textarea id="ee-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          {lines.length === 0 ? (
            <p className={`text-[12.5px] ${TONE.muted}`}>
              Nothing is left to {kind === "DELIVERY" ? "deliver" : "accept"} on this PO.
            </p>
          ) : (
            <section className="space-y-2">
              <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines</h3>
              {lines.map((line) => (
                <div key={line.poLineId} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                  <div className="truncate text-[13px] sm:col-span-5" title={line.description}>{line.description}</div>
                  <div className={`flex items-center text-[12px] sm:col-span-3 ${TONE.muted}`}>
                    {kind === "DELIVERY" ? `Left ${line.remaining.toFixed(2)}` : `Left ${formatMoney(line.remaining.toFixed(2), "BDT")}`}
                  </div>
                  <Input
                    aria-label={`${line.description} ${kind === "DELIVERY" ? "quantity" : "amount"}`}
                    className="sm:col-span-2"
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.value}
                    onChange={(e) => update(line.poLineId, e.target.value)}
                    placeholder={kind === "DELIVERY" ? "Qty" : "Amount"}
                  />
                  <div className={`flex items-center text-[12px] sm:col-span-2 ${TONE.muted}`}>
                    {kind === "DELIVERY" && Number(line.value) > 0
                      ? `${formatMoney((Number(line.value) * Number(line.unitPrice)).toFixed(2), "BDT")} at the PO price`
                      : null}
                  </div>
                </div>
              ))}
            </section>
          )}

          <p className={`text-[11.5px] ${TONE.muted}`}>Keep the signed copy on paper for now: attachments are not built yet.</p>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={save.isPending}
            disabled={!canSubmit}
            submitLabel="Save as draft"
            onCancel={() => onOpenChange(false)}
            onSubmit={() => save.mutate()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
