"use client"

import { Field } from "@/components/dashboard/record-kit"
import { Input } from "@/components/ui/input"
import { todayIso, type QuoteDraft } from "@/lib/quotes"

/** The four boxes of a quote, shared by the stage change and Add quote (owner, 2026-10-13). */
export function QuoteFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: QuoteDraft
  onChange: (next: QuoteDraft) => void
  idPrefix: string
}) {
  const set = (key: keyof QuoteDraft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: e.target.value })
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Quote amount (৳)" htmlFor={`${idPrefix}-amount`}>
        <Input id={`${idPrefix}-amount`} inputMode="decimal" value={draft.amount} onChange={set("amount")} placeholder="1200000" />
      </Field>
      <Field label="Quote date" htmlFor={`${idPrefix}-date`}>
        <Input id={`${idPrefix}-date`} type="date" max={todayIso()} value={draft.quotedOn} onChange={set("quotedOn")} />
      </Field>
      <Field label="Quote number (optional)" htmlFor={`${idPrefix}-ref`}>
        <Input id={`${idPrefix}-ref`} maxLength={60} value={draft.reference} onChange={set("reference")} placeholder="BS-Q-0012" />
      </Field>
      <Field label="Note (optional)" htmlFor={`${idPrefix}-note`}>
        <Input id={`${idPrefix}-note`} maxLength={300} value={draft.note} onChange={set("note")} placeholder="10% off after the OEM price drop" />
      </Field>
    </div>
  )
}
