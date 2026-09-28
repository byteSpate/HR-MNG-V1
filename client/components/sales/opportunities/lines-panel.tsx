"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine } from "@remixicon/react"

import {
  addOpportunityLine, deleteOpportunityLine, reorderOpportunityLines,
  suggestOpportunityLineValues, updateOpportunity, updateOpportunityLine,
} from "@/lib/api/sales/opportunities"
import { opportunityWriteKeys, salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunityLineSummary, OpportunitySummary } from "@/lib/api/types"
import {
  ConfirmDeleteDialog, Field, PanelAlert, PanelNotice, RowActions, TONE, toMessage,
} from "@/components/dashboard/record-kit"
import { taka } from "@/components/sales/shared/sales-shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { SupplierPicker } from "@/components/sales/opportunities/supplier-picker"

export function onDate(value: string | null): string {
  if (!value) return "—"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

/* -------------------------------------------------------------------------- */
/* Lines                                                                       */
/* -------------------------------------------------------------------------- */

/** Settles on a value once typing pauses, so a suggestion request is not sent per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * Values already used on deals this viewer can see, offered through the
 * browser's own suggestion list. Free text stays allowed: a new product is
 * typed once and suggested from then on.
 *
 * A failed request leaves the list empty and nothing else. Suggestions are an
 * aid to typing, not a record, and the field works the same without them.
 */
function SuggestionList({ id, field, q }: { id: string; field: "product" | "brand" | "model"; q: string }) {
  const { accessToken } = useSession()
  const term = useDebounced(q.trim(), 250)
  const query = useQuery({
    queryKey: salesKeys.lineSuggestions(field, term),
    queryFn: () => suggestOpportunityLineValues(accessToken!, field, term),
    enabled: !!accessToken,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  })
  return (
    <datalist id={id}>
      {(query.data ?? []).map((value) => (
        <option key={value} value={value} />
      ))}
    </datalist>
  )
}

/** A margin in taka as a person says it: a loss is named, not printed with a minus sign. */
export function marginWords(amount: string): string {
  const value = Number(amount)
  return value < 0 ? `a loss of ${taka(String(-value))}` : taka(amount)
}

/**
 * What a typed margin comes to, while typing. Shown, never sent: the server
 * works the margin out from the Total price it stores.
 */
export function marginPreview(totalPrice: string, percent: string): string | null {
  const rate = Number(percent.trim())
  if (!percent.trim() || !Number.isFinite(rate) || Math.abs(rate) > 100) return null
  const value = Number(totalPrice.replace(/[,\s]/g, ""))
  // Total price is never worked out from quantity and price per unit, so a
  // margin has nothing to be a percentage of until one is typed.
  if (!totalPrice.trim() || !Number.isFinite(value)) return "Add the Total price to see it in taka."
  const margin = Math.round(value * rate) / 100
  return margin < 0 ? `A loss of ${taka(String(-margin))}.` : `${taka(String(margin))} on this product.`
}

export function LinesPanel({ deal, canManage }: { deal: OpportunitySummary; canManage: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [product, setProduct] = useState("")
  const [oemBrand, setOemBrand] = useState("")
  const [model, setModel] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unitValue, setUnitValue] = useState("")
  const [lineValue, setLineValue] = useState("")
  const [marginPercent, setMarginPercent] = useState("")
  const [note, setNote] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [editing, setEditing] = useState<OpportunityLineSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<OpportunityLineSummary | null>(null)

  const clearLineForm = () => {
    setEditing(null); setProduct(""); setOemBrand(""); setModel("")
    setQuantity(""); setUnitValue(""); setLineValue(""); setMarginPercent(""); setNote("")
    setSupplierId(""); setError(null)
  }

  const invalidate = () => {
    for (const key of opportunityWriteKeys(deal.id)) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const saveLine = useMutation({
    mutationFn: () =>
      editing
        ? updateOpportunityLine(accessToken!, editing.id, {
            product: product.trim(), oemBrand: oemBrand.trim() || null,
            model: model.trim() || null, quantity: quantity.trim() ? Number(quantity) : null,
            unitValue: unitValue.trim() || null, lineValue: lineValue.trim() || null,
            marginPercent: marginPercent.trim() || null,
            note: note.trim() || null,
            supplierId: supplierId || null,
          })
        : addOpportunityLine(accessToken!, deal.id, {
            product: product.trim(), oemBrand: oemBrand.trim() || undefined,
            model: model.trim() || undefined, quantity: quantity.trim() ? Number(quantity) : undefined,
            unitValue: unitValue.trim() || undefined, lineValue: lineValue.trim() || undefined,
            marginPercent: marginPercent.trim() || undefined,
            note: note.trim() || undefined,
            supplierId: supplierId || undefined,
          }),
    onSuccess: () => {
      setAdding(false)
      clearLineForm()
      invalidate()
      // A new product or brand is suggested from now on.
      queryClient.invalidateQueries({ queryKey: ["sales", "suggestions"] })
    },
    onError: (err) => setError(toMessage(err)),
  })

  const reorder = useMutation({
    mutationFn: (lineIds: string[]) => reorderOpportunityLines(accessToken!, deal.id, lineIds),
    onSuccess: invalidate,
    onError: (err) => setError(toMessage(err)),
  })

  const beginEdit = (line: OpportunityLineSummary) => {
    setEditing(line); setAdding(true); setProduct(line.product); setOemBrand(line.oemBrand ?? "")
    setModel(line.model ?? ""); setQuantity(line.quantity?.toString() ?? "")
    setUnitValue(line.unitValue ?? ""); setLineValue(line.lineValue ?? ""); setNote(line.note ?? "")
    setSupplierId(line.supplier?.id ?? "")
    // "12.00" from the server reads as 12 in the field.
    setMarginPercent(line.marginPercent ? String(Number(line.marginPercent)) : "")
  }

  const move = (index: number, delta: -1 | 1) => {
    const next = deal.lines.map((line) => line.id)
    const destination = index + delta
    if (destination < 0 || destination >= next.length) return
    ;[next[index], next[destination]] = [next[destination], next[index]]
    reorder.mutate(next)
  }

  const remove = useMutation({
    mutationFn: (lineId: string) => deleteOpportunityLine(accessToken!, lineId),
    onSuccess: () => {
      setRemoving(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  // The deal value is the figure everything else reads. The line total sits
  // beside it as detail and is never written into it automatically — pressing
  // the button below is a person's decision, not the interface tidying up.
  const reconcile = useMutation({
    mutationFn: () => updateOpportunity(accessToken!, deal.id, { amount: deal.lineTotal }),
    onSuccess: invalidate,
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Panel>
      <PanelHeading
        title="Products"
        action={
          canManage && !adding ? (
            <Button
              type="button"
              onClick={() => { clearLineForm(); setAdding(true) }}
              className="h-8 gap-1 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
            >
              <RiAddLine className="size-3.5" aria-hidden />
              Add
            </Button>
          ) : undefined
        }
      />

      {error ? <PanelAlert>{error}</PanelAlert> : null}

      {/* Stated plainly, with one button and no automatic write. Two numbers
          that disagree is a fact worth showing; silently making them agree
          would destroy whichever one was right. */}
      {deal.amountDiffersFromLines ? (
        <PanelNotice>
          <span className="flex flex-wrap items-center gap-2">
            <span>
              The deal value is {taka(deal.amount)}, but the products add up to {taka(deal.lineTotal)}.
            </span>
            {canManage ? (
              <Button
                type="button"
                variant="link"
                disabled={reconcile.isPending}
                onClick={() => reconcile.mutate()}
                className="h-auto p-0 text-[12px] font-bold text-[#8A5E0C] underline"
              >
                Use products total as deal value
              </Button>
            ) : null}
          </span>
        </PanelNotice>
      ) : null}

      {deal.lines.length === 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>
          No products yet. A deal can carry several products, each with its own quantity and
          price; the deal value stays the figure the funnel reads.
        </p>
      ) : (
        <ul>
          {deal.lines.map((line, index) => (
            <li key={line.id} className="border-b border-[#EEF1F5] py-2.5 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{line.product}</div>
                  <div className={`text-[11.5px] ${TONE.muted}`}>
                    {[
                      line.oemBrand,
                      line.model,
                      line.quantity !== null ? `Qty ${line.quantity}` : null,
                      line.supplier ? `Supplier: ${line.supplier.name}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No further detail"}
                  </div>
                  {line.note ? <div className={`mt-0.5 text-[11.5px] ${TONE.muted}`}>{line.note}</div> : null}
                </div>
                <div className="text-right">
                  {/* No price yet, never ৳0 — a product nobody has priced is not a
                      product being given away. */}
                  <div
                    className={line.lineValue === null ? `text-[12.5px] ${TONE.muted}` : "text-[13px]"}
                  >
                    {taka(line.lineValue)}
                  </div>
                  {line.marginPercent !== null ? (
                    <div className={`text-[11.5px] ${TONE.muted}`}>
                      Margin {Number(line.marginPercent)}%
                      {line.marginAmount !== null ? ` · ${marginWords(line.marginAmount)}` : ", no total price yet"}
                    </div>
                  ) : null}
                  {canManage ? (
                    <>
                      <RowActions
                        actions={[
                          { kind: "edit", label: "Edit", onClick: () => beginEdit(line) },
                          { kind: "delete", label: "Remove", onClick: () => setRemoving(line) },
                        ]}
                      />
                      <div className="mt-1 flex justify-end gap-1">
                        <Button type="button" variant="link" disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)} className="h-auto p-0 text-[11px]">Up</Button>
                        <Button type="button" variant="link" disabled={index === deal.lines.length - 1 || reorder.isPending} onClick={() => move(index, 1)} className="h-auto p-0 text-[11px]">Down</Button>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deal.lines.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-[#E4E9EF] pt-3">
          <span className={`text-[12px] ${TONE.muted}`}>
            Products total
            {/* The excluded count is stated rather than folded in as zero. */}
            {deal.unpricedLineCount > 0
              ? `, not counting ${deal.unpricedLineCount} with no price yet`
              : ""}
          </span>
          <span className="text-[13.5px] font-bold">{taka(deal.lineTotal)}</span>
        </div>
      ) : null}

      {deal.lines.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <span className={`text-[12px] ${TONE.muted}`}>
            Margin total
            {/* The excluded count is stated rather than folded in as zero. */}
            {deal.unmarginedLineCount > 0
              ? `, not counting ${deal.unmarginedLineCount} with no margin yet`
              : ""}
          </span>
          <span className={deal.marginAmount === null ? `text-[13px] ${TONE.muted}` : "text-[13.5px] font-bold"}>
            {deal.marginAmount === null ? "No margin yet" : marginWords(deal.marginAmount)}
          </span>
        </div>
      ) : null}

      {adding ? (
        <div className="mt-3 space-y-3 border-t border-[#E4E9EF] pt-3">
          <Field label="Product" htmlFor="line-product">
            <Input id="line-product" list="line-product-suggestions" autoComplete="off" value={product} onChange={(e) => setProduct(e.target.value)} />
            <SuggestionList id="line-product-suggestions" field="product" q={product} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="OEM brand" htmlFor="line-brand" hint="Optional." help="The maker, like Cisco or Fortinet. Names you have used before are suggested.">
              <Input id="line-brand" list="line-brand-suggestions" autoComplete="off" value={oemBrand} onChange={(e) => setOemBrand(e.target.value)} />
              <SuggestionList id="line-brand-suggestions" field="brand" q={oemBrand} />
            </Field>
            <Field label="Model" htmlFor="line-model" hint="Optional." help="The exact model, like FortiGate 100F.">
              <Input id="line-model" list="line-model-suggestions" autoComplete="off" value={model} onChange={(e) => setModel(e.target.value)} />
              <SuggestionList id="line-model-suggestions" field="model" q={model} />
            </Field>
            <Field label="Supplier" htmlFor="line-supplier" hint="Optional for now." help="Who we buy this product from. Every product needs one before the Opportunity can be marked Won.">
              <SupplierPicker value={supplierId} onChange={setSupplierId} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="line-qty" hint="Optional." help="Leave it empty for a service, like installation.">
              <Input
                id="line-qty"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Price per unit" htmlFor="line-unit-value" hint="Optional." help="The price of one piece, kept for reference. It is not added up anywhere.">
              <Input id="line-unit-value" inputMode="decimal" value={unitValue} onChange={(e) => setUnitValue(e.target.value)} />
            </Field>
            <Field
              label="Total price"
              htmlFor="line-value"
              hint="Optional." help="The price for all of them together, typed by you — it is not worked out from the price per unit. Leave it empty if there is no price yet."
            >
              <Input
                id="line-value"
                inputMode="decimal"
                value={lineValue}
                onChange={(e) => setLineValue(e.target.value)}
              />
            </Field>
            <Field
              label="Margin (%)"
              htmlFor="line-margin"
              hint={["Optional.", marginPreview(lineValue, marginPercent)].filter(Boolean).join(" ")}
              help="The profit on this product, as a percentage of its Total price. Type a minus sign for a product sold at a loss, like -5. The Opportunity's margin is its products' margins added up."
            >
              <Input
                id="line-margin"
                inputMode="decimal"
                value={marginPercent}
                onChange={(e) => setMarginPercent(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Note" htmlFor="line-note" hint="Optional." help="Anything else about this product.">
            <Input id="line-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={saveLine.isPending || !product.trim()}
              onClick={() => saveLine.mutate()}
              className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              {saveLine.isPending ? "Saving…" : editing ? "Save product" : "Add product"}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setAdding(false)
                clearLineForm()
              }}
              className="h-8 p-0 text-[12px] font-bold text-[#5F6B7C]"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDeleteDialog
        open={!!removing}
        what={removing ? `the "${removing.product}" product` : "this product"}
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Panel>
  )
}
