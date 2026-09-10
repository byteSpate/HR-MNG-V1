"use client"

import { useState } from "react"
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
  updateOpportunity,
} from "@/lib/api/sales"
import { opportunityWriteKeys, salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type {
  OpportunityLineSummary,
  OpportunityStage,
  OpportunityStatus,
  OpportunitySummary,
} from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import {
  ConfirmDeleteDialog,
  Field,
  PanelAlert,
  PanelNotice,
  RowActions,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import { CommentPanel } from "@/components/sales/comment-panel"
import {
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_STATUS_TONE,
  STAGE_LABEL,
  STAGE_WAITING_ON,
  daysSince,
  stageSentence,
  taka,
} from "@/components/sales/sales-shared"
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

function LinesPanel({ deal, canManage }: { deal: OpportunitySummary; canManage: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [product, setProduct] = useState("")
  const [quantity, setQuantity] = useState("")
  const [lineValue, setLineValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<OpportunityLineSummary | null>(null)

  const invalidate = () => {
    for (const key of opportunityWriteKeys(deal.id)) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const add = useMutation({
    mutationFn: () =>
      addOpportunityLine(accessToken!, deal.id, {
        product: product.trim(),
        quantity: quantity.trim() ? Number(quantity) : undefined,
        lineValue: lineValue.trim() || undefined,
      }),
    onSuccess: () => {
      setAdding(false)
      setProduct("")
      setQuantity("")
      setLineValue("")
      setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

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
        title="Line items"
        action={
          canManage && !adding ? (
            <Button
              type="button"
              onClick={() => setAdding(true)}
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
              The deal value is {taka(deal.amount)} and the priced lines total {taka(deal.lineTotal)}.
            </span>
            {canManage ? (
              <Button
                type="button"
                variant="link"
                disabled={reconcile.isPending}
                onClick={() => reconcile.mutate()}
                className="h-auto p-0 text-[12px] font-bold text-[#8A5E0C] underline"
              >
                Set deal value to line total
              </Button>
            ) : null}
          </span>
        </PanelNotice>
      ) : null}

      {deal.lines.length === 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>
          No line items yet. A deal can carry several products, each with its own quantity and
          value; the deal value stays the figure the funnel reads.
        </p>
      ) : (
        <ul>
          {deal.lines.map((line) => (
            <li key={line.id} className="border-b border-[#EEF1F5] py-2.5 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold">{line.product}</div>
                  <div className={`text-[11.5px] ${TONE.muted}`}>
                    {[line.oemBrand, line.model, line.quantity !== null ? `Qty ${line.quantity}` : null]
                      .filter(Boolean)
                      .join(" · ") || "No further detail"}
                  </div>
                </div>
                <div className="text-right">
                  {/* Unpriced, never ৳0 — a line nobody has costed is not a
                      line being given away. */}
                  <div
                    className={line.lineValue === null ? `text-[12.5px] ${TONE.muted}` : "text-[13px]"}
                  >
                    {taka(line.lineValue)}
                  </div>
                  {canManage ? (
                    <RowActions
                      actions={[{ kind: "delete", label: "Remove", onClick: () => setRemoving(line) }]}
                    />
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
            Line total
            {/* The excluded count is stated rather than folded in as zero. */}
            {deal.unpricedLineCount > 0
              ? `, excluding ${deal.unpricedLineCount} unpriced line${
                  deal.unpricedLineCount === 1 ? "" : "s"
                }`
              : ""}
          </span>
          <span className="text-[13.5px] font-bold">{taka(deal.lineTotal)}</span>
        </div>
      ) : null}

      {adding ? (
        <div className="mt-3 space-y-3 border-t border-[#E4E9EF] pt-3">
          <Field label="Product" htmlFor="line-product">
            <Input id="line-product" value={product} onChange={(e) => setProduct(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quantity" htmlFor="line-qty" hint="Optional. Some lines are services.">
              <Input
                id="line-qty"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field
              label="Line value"
              htmlFor="line-value"
              hint="Optional. Leave it empty and the line reads as unpriced."
            >
              <Input
                id="line-value"
                inputMode="decimal"
                value={lineValue}
                onChange={(e) => setLineValue(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={add.isPending || !product.trim()}
              onClick={() => add.mutate()}
              className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              {add.isPending ? "Adding…" : "Add line"}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setAdding(false)
                setError(null)
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
        what={removing ? `the "${removing.product}" line` : "this line"}
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
      }),
    onSuccess: invalidate,
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Panel>
      <PanelHeading title="Workflow" />
      {error ? <PanelAlert>{error}</PanelAlert> : null}

      <Field
        label="Stage"
        hint={
          isOpen
            ? STAGE_WAITING_ON[deal.stage]
            : // Disabled with the reason rather than hidden: the control is
              // the obvious place to look for why it cannot be used.
              `This deal is ${OPPORTUNITY_STATUS_LABEL[
                deal.status
              ].toLowerCase()}, so its stage is frozen where it ended. Reopen it to move the stage again.`
        }
      >
        <Select
          value={deal.stage}
          onValueChange={(v) => v && stageMutation.mutate(v as OpportunityStage)}
          disabled={!canManage || !isOpen || stageMutation.isPending}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {(v: string | null) => STAGE_LABEL[(v ?? deal.stage) as OpportunityStage]}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {/* Every stage, in both directions. Deals genuinely go backwards
                when a customer changes the requirement after a quote, and a
                forward-only ladder makes people either lie or stop updating. */}
            {STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

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
                hint={
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

      <div className="mt-4 border-t border-[#E4E9EF] pt-4">
        <Field
          label="Next step"
          htmlFor="next-step"
          hint="The one thing that happens next. A note on the deal, not a task with a reminder."
        >
          <Input
            id="next-step"
            value={nextStep}
            onChange={(e) => setNextStep(e.target.value)}
            disabled={!canManage}
          />
        </Field>
        <div className="mt-3">
          <Field label="Due" htmlFor="next-step-due">
            <Input
              id="next-step-due"
              type="date"
              value={nextStepDueOn}
              onChange={(e) => setNextStepDueOn(e.target.value)}
              disabled={!canManage}
            />
          </Field>
        </div>
        {canManage ? (
          <Button
            type="button"
            disabled={nextStepMutation.isPending}
            onClick={() => nextStepMutation.mutate()}
            className="mt-3 h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            {nextStepMutation.isPending ? "Saving…" : "Save next step"}
          </Button>
        ) : null}
      </div>
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
          {query.data!.items.map((item) => (
            <li
              key={item.id}
              className="flex gap-2.5 border-b border-[#EEF1F5] py-2.5 last:border-b-0"
            >
              <RiFlashlightLine className="mt-0.5 size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
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
          ))}
        </ul>
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
              {/* Unpriced, never ৳0. */}
              <span className={deal.amount === null ? TONE.muted : undefined}>
                {taka(deal.amount)}
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

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,1.6fr)]">
            <div className="grid gap-4">
              <WorkflowPanel deal={deal} canManage={canManage} />
              <LinesPanel deal={deal} canManage={canManage} />
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
              {/*
                Said rather than shown. An account has a field-by-field History
                panel; a deal does not, because no endpoint returns one yet.
                Rendering an empty panel here would claim nothing had ever
                changed, which is a different and false statement.
              */}
              <Panel>
                <PanelHeading title="History" />
                <p className={`text-[12.5px] ${TONE.muted}`}>
                  A field-by-field record for a deal is not built yet. Every change is audited on
                  the server, and stage changes, comments and closures appear on the Timeline above.
                </p>
              </Panel>
            </div>
          </div>
        </>
      ) : null}
    </>
  )
}
