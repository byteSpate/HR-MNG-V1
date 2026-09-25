"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine, RiErrorWarningLine, RiEyeLine, RiFlashlightLine } from "@remixicon/react"

import {
  addOpportunityLine,
  changeOpportunityNextStep,
  changeOpportunityStage,
  changeOpportunityStatus,
  deleteOpportunityLine,
  getOpportunity,
  getOpportunityTimeline,
  getOpportunityHistory,
  reorderOpportunityLines,
  suggestOpportunityLineValues,
  updateOpportunityLine,
  updateOpportunity,
} from "@/lib/api/sales/opportunities"
import { opportunityWriteKeys, planWriteKeys, salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type {
  OpportunityLineSummary,
  OpportunityStage,
  OpportunityStatus,
  OpportunitySummary,
} from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import {
  CheckboxField,
  ConfirmDeleteDialog,
  Field,
  PanelAlert,
  PanelNotice,
  RowActions,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import { CommentPanel } from "@/components/sales/shared/comment-panel"
import { OpportunityFormDialog } from "@/components/sales/opportunities/opportunity-form-dialog"
import {
  MEETING_ICON,
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_STATUS_TONE,
  STAGE_LABEL,
  STAGE_WAITING_ON,
  TASK_ICON,
  daysSince,
  stageSentence,
  taka,
} from "@/components/sales/shared/sales-shared"
import { MeetingsPanel, TasksPanel } from "@/components/sales/shared/plan-panels"
import { MoneySection } from "@/components/money/money-section"
import { StageBar } from "@/components/sales/opportunities/stage-bar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

const STAGES = Object.keys(STAGE_LABEL) as OpportunityStage[]
const CLOSING_STATUSES: OpportunityStatus[] = ["WON", "LOST", "CANCELLED"]

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
      {children}
    </div>
  )
}

function PanelHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-[13.5px] font-bold">{title}</div>
      {action}
    </div>
  )
}

function onDate(value: string | null): string {
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
function marginWords(amount: string): string {
  const value = Number(amount)
  return value < 0 ? `a loss of ${taka(String(-value))}` : taka(amount)
}

/**
 * What a typed margin comes to, while typing. Shown, never sent: the server
 * works the margin out from the Total price it stores.
 */
function marginPreview(totalPrice: string, percent: string): string | null {
  const rate = Number(percent.trim())
  if (!percent.trim() || !Number.isFinite(rate) || Math.abs(rate) > 100) return null
  const value = Number(totalPrice.replace(/[,\s]/g, ""))
  // Total price is never worked out from quantity and price per unit, so a
  // margin has nothing to be a percentage of until one is typed.
  if (!totalPrice.trim() || !Number.isFinite(value)) return "Add the Total price to see it in taka."
  const margin = Math.round(value * rate) / 100
  return margin < 0 ? `A loss of ${taka(String(-margin))}.` : `${taka(String(margin))} on this product.`
}

function LinesPanel({ deal, canManage }: { deal: OpportunitySummary; canManage: boolean }) {
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
  const [editing, setEditing] = useState<OpportunityLineSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<OpportunityLineSummary | null>(null)

  const clearLineForm = () => {
    setEditing(null); setProduct(""); setOemBrand(""); setModel("")
    setQuantity(""); setUnitValue(""); setLineValue(""); setMarginPercent(""); setNote(""); setError(null)
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
          })
        : addOpportunityLine(accessToken!, deal.id, {
            product: product.trim(), oemBrand: oemBrand.trim() || undefined,
            model: model.trim() || undefined, quantity: quantity.trim() ? Number(quantity) : undefined,
            unitValue: unitValue.trim() || undefined, lineValue: lineValue.trim() || undefined,
            marginPercent: marginPercent.trim() || undefined,
            note: note.trim() || undefined,
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
                    {[line.oemBrand, line.model, line.quantity !== null ? `Qty ${line.quantity}` : null]
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
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="OEM brand" htmlFor="line-brand" hint="Optional." help="The maker, like Cisco or Fortinet. Names you have used before are suggested.">
              <Input id="line-brand" list="line-brand-suggestions" autoComplete="off" value={oemBrand} onChange={(e) => setOemBrand(e.target.value)} />
              <SuggestionList id="line-brand-suggestions" field="brand" q={oemBrand} />
            </Field>
            <Field label="Model" htmlFor="line-model" hint="Optional." help="The exact model, like FortiGate 100F.">
              <Input id="line-model" list="line-model-suggestions" autoComplete="off" value={model} onChange={(e) => setModel(e.target.value)} />
              <SuggestionList id="line-model-suggestions" field="model" q={model} />
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
              help="The profit on this product, as a percentage of its Total price. Type a minus sign for a product sold at a loss, like -5. The deal's margin is its products' margins added up."
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

/* -------------------------------------------------------------------------- */
/* Stage, status and next step                                                 */
/* -------------------------------------------------------------------------- */

function WorkflowPanel({ deal, canManage }: { deal: OpportunitySummary; canManage: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState<OpportunityStatus | null>(null)
  const [reason, setReason] = useState("")
  const [nextStep, setNextStep] = useState(deal.nextStep ?? "")
  const [nextStepDueOn, setNextStepDueOn] = useState(deal.nextStepDueOn ?? "")
  // Unticked every time (revision §24.11): making a task is a choice, not a default.
  const [alsoTask, setAlsoTask] = useState(false)

  const isOpen = deal.status === "ONGOING"
  const invalidate = () => {
    for (const key of opportunityWriteKeys(deal.id)) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const stageMutation = useMutation({
    mutationFn: (stage: OpportunityStage) => changeOpportunityStage(accessToken!, deal.id, stage),
    onSuccess: invalidate,
    onError: (err) => setError(toMessage(err)),
  })

  const statusMutation = useMutation({
    mutationFn: (body: { status: OpportunityStatus; statusReason?: string }) =>
      changeOpportunityStatus(accessToken!, deal.id, body),
    onSuccess: () => {
      setClosing(null)
      setReason("")
      setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const nextStepMutation = useMutation({
    mutationFn: () =>
      changeOpportunityNextStep(accessToken!, deal.id, {
        nextStep: nextStep.trim() || null,
        nextStepDueOn: nextStepDueOn || null,
        ...(alsoTask ? { alsoCreateTask: true } : {}),
      }),
    onSuccess: () => {
      invalidate()
      if (alsoTask) {
        for (const key of planWriteKeys()) queryClient.invalidateQueries({ queryKey: key })
        setAlsoTask(false)
      }
    },
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Panel>
      <PanelHeading title="Workflow" />
      {error ? <PanelAlert>{error}</PanelAlert> : null}

      {canManage ? (
        <Field
          label="Stage"
          hint={isOpen ? STAGE_WAITING_ON[deal.stage] : `This deal is ${OPPORTUNITY_STATUS_LABEL[deal.status].toLowerCase()}, so its stage is frozen where it ended. Reopen it to move the stage again.`}
        >
          <Select value={deal.stage} onValueChange={(v) => v && stageMutation.mutate(v as OpportunityStage)} disabled={!isOpen || stageMutation.isPending}>
            <SelectTrigger className="w-full"><SelectValue>{(v: string | null) => STAGE_LABEL[(v ?? deal.stage) as OpportunityStage]}</SelectValue></SelectTrigger>
            <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABEL[s]}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      ) : (
        <div>
          <div className={`text-[11.5px] font-semibold ${TONE.muted}`}>Stage</div>
          <div className="mt-1 text-[13px] font-semibold">{STAGE_LABEL[deal.stage]}</div>
          <div className={`mt-0.5 text-[11.5px] ${TONE.muted}`}>{STAGE_WAITING_ON[deal.stage]}</div>
        </div>
      )}

      <StageBar status={deal.status} stage={deal.stage} className="mt-2.5 max-w-[16rem]" />

      {isOpen ? (
        <div className="mt-1.5 text-[11.5px] text-[#6B7789]">
          {daysSince(deal.stageChangedAt)} days in this stage
        </div>
      ) : null}

      <div className="mt-4">
        {isOpen ? (
          canManage ? (
            <div className="flex flex-wrap gap-2">
              {CLOSING_STATUSES.map((s) => (
                <Button
                  key={s}
                  type="button"
                  onClick={() => {
                    setClosing(s)
                    setReason("")
                  }}
                  className="h-8 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
                >
                  Mark {OPPORTUNITY_STATUS_LABEL[s]}
                </Button>
              ))}
            </div>
          ) : null
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[12.5px] ${TONE.muted}`}>
              {stageSentence(deal.status, deal.stage)}
              {deal.statusReason ? ` — ${deal.statusReason}` : ""}
            </span>
            {canManage ? (
              <Button
                type="button"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ status: "ONGOING" })}
                className="h-8 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
              >
                Reopen
              </Button>
            ) : null}
          </div>
        )}

        {closing ? (
          <div className="mt-3 space-y-2 rounded-md border border-[#E4E9EF] bg-[#F7F9FB] p-3">
            {/* Required for Lost and Cancelled. Both mean the deal ended, and
                which of the two it was is the useful half. */}
            {closing !== "WON" ? (
              <Field
                label="Reason"
                htmlFor="close-reason"
                help={
                  closing === "LOST"
                    ? "A competitor won. Say who, or why, so the pattern is readable later."
                    : "Nobody won — shelved, cancelled, budget withdrawn."
                }
              >
                <Input id="close-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={statusMutation.isPending || (closing !== "WON" && !reason.trim())}
                onClick={() =>
                  statusMutation.mutate({
                    status: closing,
                    ...(closing === "WON" ? {} : { statusReason: reason.trim() }),
                  })
                }
                className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
              >
                Mark {OPPORTUNITY_STATUS_LABEL[closing]}
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={() => setClosing(null)}
                className="h-8 p-0 text-[12px] font-bold text-[#5F6B7C]"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {canManage ? <div className="mt-4 border-t border-[#E4E9EF] pt-4">
        <Field
          label="Next step"
          htmlFor="next-step"
          help="The one thing that happens next, as a note on the deal. Tick the box below to also make it a task with a reminder."
        >
          <Input
            id="next-step"
            value={nextStep}
            onChange={(e) => setNextStep(e.target.value)}
          />
        </Field>
        <div className="mt-3">
          <Field label="Due" htmlFor="next-step-due">
            <Input
              id="next-step-due"
              type="date"
              value={nextStepDueOn}
              onChange={(e) => setNextStepDueOn(e.target.value)}
            />
          </Field>
        </div>
        <div className="mt-2">
          <CheckboxField label="Also make it a task for me" checked={alsoTask} onChange={setAlsoTask} />
        </div>
        <Button
            type="button"
            disabled={nextStepMutation.isPending}
            onClick={() => nextStepMutation.mutate()}
            className="mt-3 h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            {nextStepMutation.isPending ? "Saving…" : "Save next step"}
          </Button>
      </div> : (
        <div className="mt-4 border-t border-[#E4E9EF] pt-4">
          <div className={`text-[11.5px] font-semibold ${TONE.muted}`}>Next step</div>
          <p className="mt-1 text-[13px]">{deal.nextStep ?? "None set"}</p>
          <div className={`mt-1 text-[11.5px] ${TONE.muted}`}>Due {onDate(deal.nextStepDueOn)}</div>
        </div>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

function TimelinePanel({ opportunityId }: { opportunityId: string }) {
  const { accessToken } = useSession()
  const query = useQuery({
    queryKey: salesKeys.opportunityTimeline(opportunityId),
    queryFn: () => getOpportunityTimeline(accessToken!, opportunityId),
    enabled: !!accessToken,
  })

  return (
    <Panel>
      <PanelHeading title="Timeline" />
      {query.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ) : query.isError ? (
        <PanelAlert>
          <span className="flex flex-wrap items-center gap-2">
            <span>{toMessage(query.error)}</span>
            <Button
              type="button"
              variant="link"
              onClick={() => query.refetch()}
              className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
            >
              Try again
            </Button>
          </span>
        </PanelAlert>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>
          Nothing has happened on this deal yet. Stage changes, comments and closures appear here.
        </p>
      ) : (
        <ul>
          {query.data!.items.map((item) => {
            const Icon = item.kind === "meeting" ? MEETING_ICON : item.kind === "task" ? TASK_ICON : RiFlashlightLine
            return (
            <li
              key={item.id}
              className="flex gap-2.5 border-b border-[#EEF1F5] py-2.5 last:border-b-0"
            >
              <Icon className="mt-0.5 size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold">{item.title}</div>
                {item.detail ? (
                  <p className="mt-0.5 text-[12px] leading-relaxed whitespace-pre-wrap text-[#3D4756]">
                    {item.detail}
                  </p>
                ) : null}
                <div className={`mt-0.5 text-[11.5px] ${TONE.muted}`}>
                  {[item.by, item.meta, new Date(item.at).toLocaleDateString("en-GB")]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */

function HistoryPanel({ opportunityId }: { opportunityId: string }) {
  const { accessToken } = useSession()
  const query = useQuery({
    queryKey: salesKeys.opportunityHistory(opportunityId),
    queryFn: () => getOpportunityHistory(accessToken!, opportunityId),
    enabled: !!accessToken,
  })

  return (
    <Panel>
      <PanelHeading title="History" />
      {query.isPending ? (
        <div className="space-y-3"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3.5 w-1/2" /></div>
      ) : query.isError ? (
        <PanelAlert>
          <span className="flex flex-wrap items-center gap-2">
            <span>{toMessage(query.error)}</span>
            <Button type="button" variant="link" onClick={() => query.refetch()} className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline">Try again</Button>
          </span>
        </PanelAlert>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>No field changes have been recorded yet.</p>
      ) : (
        <>
          {query.data?.truncated ? <PanelNotice>Showing the newest {query.data.limit} changes.</PanelNotice> : null}
          <ul>
            {query.data!.items.map((entry) => (
              <li key={entry.id} className="border-b border-[#EEF1F5] py-2.5 last:border-b-0">
                <div className={`text-[11.5px] ${TONE.muted}`}>
                  {[entry.changedByName, new Date(entry.changedAt).toLocaleString("en-GB")].filter(Boolean).join(" · ")}
                </div>
                <ul className="mt-1 space-y-1">
                  {entry.changes.map((change) => (
                    <li key={change.field} className="text-[12.5px]">
                      <span className="font-semibold">{change.label}:</span>{" "}
                      {change.before === null ? change.after : <>{change.before} → {change.after}</>}
                    </li>
                  ))}
                </ul>
                {entry.note ? <p className={`mt-1 text-[12px] ${TONE.muted}`}>{entry.note}</p> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */

export function OpportunityDetail({ opportunityId }: { opportunityId: string }) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  const query = useQuery({
    queryKey: salesKeys.opportunity(opportunityId),
    queryFn: () => getOpportunity(accessToken!, opportunityId),
    enabled: isAuthed,
  })

  const deal = query.data
  // Decided by the server, not re-derived here. A hub member can see a deal
  // on an account they do not work — the directory is shared — and only the
  // server knows which of the two this viewer is.
  const canManage = deal?.canManage ?? false
  const [editOpen, setEditOpen] = useState(false)

  return (
    <>
      <div className="pt-7 pb-4">
        <Link
          href="/sales/opportunities"
          className="text-[12.5px] font-semibold text-[#5F6B7C] hover:underline"
        >
          ← Opportunities
        </Link>
      </div>

      {sessionStatus === "loading" || query.isPending ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="mt-2.5 h-3.5 w-72" />
        </div>
      ) : query.isError ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-8 text-center">
          <span className="mx-auto mb-2.5 flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          {/* Verbatim: "does not exist, or is not yours" already says it. */}
          <p className="text-[13px] font-semibold text-[#B03A3A]">{toMessage(query.error)}</p>
        </div>
      ) : deal ? (
        <>
          <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`font-mono text-[12px] ${TONE.muted}`}>{deal.serial}</span>
              <h1 className="font-heading text-[21px] font-bold tracking-tight">{deal.name}</h1>
              <Tag
                label={OPPORTUNITY_STATUS_LABEL[deal.status]}
                tone={OPPORTUNITY_STATUS_TONE[deal.status]}
              />
              {!canManage ? <Tag label="View only" tone="neutral" /> : null}
              {canManage ? (
                <Button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="ml-auto h-auto rounded-md border border-[#E4E9EF] bg-white px-2.5 py-1.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
                >
                  Edit
                </Button>
              ) : null}
            </div>

            <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-[#5F6B7C]">
              <Link
                href={`/sales/accounts/${deal.salesAccountId}`}
                className="font-semibold hover:underline"
              >
                {deal.salesAccountName}
              </Link>
              <span>Owner: {deal.ownerName}</span>
              <span>{stageSentence(deal.status, deal.stage)}</span>
              {/* No price yet, never ৳0. */}
              <span className={deal.amount === null ? TONE.muted : undefined}>
                {taka(deal.amount)}
              </span>
              {/* The deal's margin is its products' margins, added up by the
                  server. No margin yet, never ৳0. */}
              <span className={deal.marginAmount === null ? TONE.muted : undefined}>
                {deal.marginAmount === null ? "No margin yet" : `Margin ${marginWords(deal.marginAmount)}`}
              </span>
              <span>Expected close: {onDate(deal.expectedCloseDate)}</span>
            </div>

            {deal.oemAccountManager ? (
              <div className={`mt-1.5 text-[12.5px] ${TONE.muted}`}>
                OEM contact: {deal.oemAccountManager}
              </div>
            ) : null}

            {!canManage ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-2 text-[12px] leading-relaxed text-[#5F6B7C]">
                <RiEyeLine className="mt-px size-3.5 shrink-0" aria-hidden />
                You can see this deal because its account is shared in All Accounts, but only the
                people who work that account can change it.
              </p>
            ) : null}
          </div>

          {canManage ? (
            <OpportunityFormDialog
              accountId={deal.salesAccountId}
              deal={deal}
              open={editOpen}
              onOpenChange={setEditOpen}
            />
          ) : null}

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,1.6fr)]">
            <div className="grid gap-4">
              <WorkflowPanel deal={deal} canManage={canManage} />
              <LinesPanel deal={deal} canManage={canManage} />
              {deal.status === "WON" ? <MoneySection opportunityId={deal.id} /> : null}
              <MeetingsPanel accountId={deal.salesAccountId} opportunityId={deal.id} canManage={canManage} />
              <TasksPanel accountId={deal.salesAccountId} opportunityId={deal.id} canManage={canManage} />
            </div>
            <div className="grid gap-4">
              <CommentPanel
                entity="OPPORTUNITY"
                entityId={deal.id}
                // "Comments" here, "Remarks" on an account. Same component,
                // and the two labels must not be made consistent.
                label="Comments"
                kinds={
                  isSalesAdmin
                    ? ["GENERAL", "CUSTOMER_FEEDBACK", "MANAGEMENT_NOTE"]
                    : ["GENERAL", "CUSTOMER_FEEDBACK"]
                }
                canWrite={canManage}
              />
              <TimelinePanel opportunityId={deal.id} />
              <HistoryPanel opportunityId={deal.id} />
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
