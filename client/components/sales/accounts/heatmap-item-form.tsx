"use client"

import type { HeatmapCardView, HeatmapFieldView } from "@/lib/api/types"
import { Field } from "@/components/dashboard/record-kit"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { ItemDraft } from "@/lib/heatmap"

const SELECT =
  "h-9 w-full rounded-md border border-[#E4E9EF] bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#17191C]/20"

/** One of the card's own fields, with the control that fits its kind. */
function ExtraField({ field, value, onChange, id }: {
  field: HeatmapFieldView
  value: string
  onChange: (next: string) => void
  id: string
}) {
  if (field.type === "CHOICE" || field.type === "YES_NO") {
    const options = field.type === "YES_NO" ? [["YES", "Yes"], ["NO", "No"]] : (field.options ?? []).map((o) => [o, o])
    return (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={SELECT}>
        <option value="">Not recorded</option>
        {options.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    )
  }
  if (field.type === "DATE") return <DatePicker id={id} value={value} onChange={onChange} />
  if (field.type === "NUMBER") {
    return <Input id={id} inputMode="decimal" value={value} maxLength={10} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} />
  }
  return <Input id={id} value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} />
}

/**
 * The boxes for one item on a card. The shared boxes are the same on every
 * card (only the words for "how many" and the end date change); the card's own
 * fields come from the server's list, so no card is spelled out here.
 */
export function HeatmapItemForm({ card, draft, onChange }: {
  card: HeatmapCardView
  draft: ItemDraft
  onChange: (next: ItemDraft) => void
}) {
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => onChange({ ...draft, [key]: value })
  const id = (name: string) => `heatmap-${card.key}-${name}`
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Brand" htmlFor={id("brand")}>
        <Input id={id("brand")} value={draft.brand} maxLength={100} onChange={(e) => set("brand", e.target.value)} />
      </Field>
      <Field label="Model" htmlFor={id("model")}>
        <Input id={id("model")} value={draft.model} maxLength={100} onChange={(e) => set("model", e.target.value)} />
      </Field>
      <Field label={card.quantityLabel} htmlFor={id("quantity")}>
        <Input id={id("quantity")} inputMode="numeric" value={draft.quantity} maxLength={7} onChange={(e) => set("quantity", e.target.value.replace(/\D/g, ""))} />
      </Field>
      <Field label="Where it is" htmlFor={id("site")} hint="The site or branch.">
        <Input id={id("site")} value={draft.site} maxLength={100} onChange={(e) => set("site", e.target.value)} />
      </Field>
      <Field label="Bought from" htmlFor={id("boughtFrom")} hint="The vendor or partner.">
        <Input id={id("boughtFrom")} value={draft.boughtFrom} maxLength={100} onChange={(e) => set("boughtFrom", e.target.value)} />
      </Field>
      <Field label="Bought on" htmlFor={id("boughtOn")}>
        <DatePicker id={id("boughtOn")} value={draft.boughtOn} onChange={(v) => set("boughtOn", v)} />
      </Field>
      <Field label={card.endsLabel} htmlFor={id("supportEndsOn")} hint="This sets the colour of the card.">
        <DatePicker id={id("supportEndsOn")} value={draft.supportEndsOn} onChange={(v) => set("supportEndsOn", v)} />
      </Field>
      <Field label="End of life" htmlFor={id("endOfLifeOn")} hint="When the maker stops selling or supporting it.">
        <DatePicker id={id("endOfLifeOn")} value={draft.endOfLifeOn} onChange={(v) => set("endOfLifeOn", v)} />
      </Field>
      <Field label="Support by" htmlFor={id("supportBy")} hint="Who gives them support.">
        <Input id={id("supportBy")} value={draft.supportBy} maxLength={100} onChange={(e) => set("supportBy", e.target.value)} />
      </Field>
      {card.extras.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          htmlFor={id(field.key)}
          hint={field.type === "DATE" ? "This also sets the colour of the card." : undefined}
        >
          <ExtraField
            field={field}
            id={id(field.key)}
            value={draft.details[field.key] ?? ""}
            onChange={(v) => set("details", { ...draft.details, [field.key]: v })}
          />
        </Field>
      ))}
      <div className="sm:col-span-2">
        <Field label="Notes" htmlFor={id("notes")}>
          <Textarea id={id("notes")} value={draft.notes} maxLength={500} rows={2} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </div>
  )
}
