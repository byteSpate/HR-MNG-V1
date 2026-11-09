"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  changeOpportunityNextStep, changeOpportunityStage,
} from "@/lib/api/sales/opportunities"
import { opportunityWriteKeys, planWriteKeys } from "@/lib/api/sales/keys"
import { funnelKeys } from "@/lib/api/sales/funnel-keys"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunityStage, OpportunitySummary, SalesStage } from "@/lib/api/types"
import { CheckboxField, Field, PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { OPPORTUNITY_STATUS_LABEL, STAGE_LABEL, STAGE_WAITING_ON, daysSince } from "@/components/sales/shared/sales-shared"
import { quoteAskFor, STAGE_LINK_FIELDS } from "@/lib/api/sales/stages"
import { fitsPair, nextWorkStage, pickPair } from "@/lib/api/sales/sales-stages"
import { moveNote, SALES_STAGE_HELP, SALES_STAGE_LABEL } from "@/lib/api/sales/sales-stage-help"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { StageBar } from "@/components/sales/opportunities/stage-bar"
import { StageLinks } from "@/components/sales/opportunities/stage-links"
import { onDate } from "@/components/sales/opportunities/lines-panel"
import { StageChangeDialog } from "@/components/sales/opportunities/stage-change-dialog"
import { StageUpdateDialog } from "@/components/sales/opportunities/stage-update-dialog"

const PRIMARY = "h-auto rounded-md bg-ink px-3.5 py-2 text-caption font-bold text-white hover:bg-ink-strong"
const QUIET = "h-auto rounded-md px-3.5 py-2 text-caption font-bold text-ink-muted hover:bg-surface-hover hover:text-ink-body"

/**
 * Stage and next step. The status itself moved to the Status tab: it is a
 * decision with a reason and a confirm dialog, and it does not belong beside
 * a dropdown that moves the Opportunity along day to day.
 */
export function WorkflowPanel({
  deal,
  canManage,
  canChangeStage = true,
  canSkipQuote = true,
}: {
  deal: OpportunitySummary
  canManage: boolean
  /** A Sales Admin can switch stage changes off for Sales Users. For looks only. */
  canChangeStage?: boolean
  /** A Sales Admin can switch "Move without a quote" off for Sales Users. For looks only. */
  canSkipQuote?: boolean
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [nextStep, setNextStep] = useState(deal.nextStep ?? "")
  const [nextStepDueOn, setNextStepDueOn] = useState(deal.nextStepDueOn ?? "")
  // Unticked every time (revision §24.11): making a task is a choice, not a default.
  const [alsoTask, setAlsoTask] = useState(false)
  // Set by a stage move, so the panel can ask whether this stage wants a
  // document link (spec 2026-09-28 §1.5). Cleared on the next stage move so
  // the question is asked once per move, not once per render.
  const [stageChanged, setStageChanged] = useState(false)
  // A quote stage asks for the quote first (owner, 2026-10-13), in a box.
  const [asking, setAsking] = useState<{ stage: OpportunityStage; ask: "REQUIRED" | "OPTIONAL"; salesStage?: SalesStage } | null>(null)
  // The Update stage box, with both stages in it.
  const [updating, setUpdating] = useState(false)
  // Said once after "Move to the next work stage" when the sales stage had to move too.
  const [movedNote, setMovedNote] = useState<string | null>(null)

  const isOpen = deal.status === "ONGOING"
  const invalidate = () => {
    for (const key of opportunityWriteKeys(deal.id)) {
      queryClient.invalidateQueries({ queryKey: key })
    }
    queryClient.invalidateQueries({ queryKey: funnelKeys.all })
  }
  const nextWork = nextWorkStage(deal.track, deal.stage)
  // Only on an open deal: a closed one cannot be changed, so the notice would have no action.
  const stagesDisagree = isOpen && deal.salesStage !== null && !fitsPair(deal.track, deal.stage, deal.salesStage)

  // One tap: the work stage goes on by one, and the sales stage follows only if it must.
  const moveToNextWorkStage = () => {
    if (!nextWork) return
    setError(null)
    setMovedNote(null)
    const pair = pickPair(deal.track, { work: deal.stage, sales: deal.salesStage }, { work: nextWork })
    const salesStage = pair.moved === "sales" ? pair.sales! : undefined
    const ask = quoteAskFor(nextWork, deal)
    if (ask) setAsking({ stage: nextWork, ask, salesStage })
    else stageMutation.mutate({ stage: nextWork, salesStage })
  }

  const stageMutation = useMutation({
    mutationFn: (body: Parameters<typeof changeOpportunityStage>[2]) => changeOpportunityStage(accessToken!, deal.id, body),
    onSuccess: (_saved, body) => {
      setStageChanged(true)
      setMovedNote(body.salesStage ? moveNote("sales", SALES_STAGE_LABEL[body.salesStage]) : null)
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

      {/* The work stage is what we do. The sales stage is where the customer is (spec 2026-11-05). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <div className={`text-caption font-semibold ${TONE.muted}`}>Work stage (what we do)</div>
          <div className="mt-1 text-body-sm font-semibold">{STAGE_LABEL[deal.stage]}</div>
          <div className={`mt-0.5 text-caption ${TONE.muted}`}>
            {isOpen ? STAGE_WAITING_ON[deal.stage] : `This Opportunity is ${OPPORTUNITY_STATUS_LABEL[deal.status].toLowerCase()}, so its stage stays where it ended.`}
          </div>
        </div>
        <div className="min-w-0">
          <div className={`text-caption font-semibold ${TONE.muted}`}>Sales stage (where the customer is)</div>
          <div className="mt-1 text-body-sm font-semibold">{deal.salesStage ? SALES_STAGE_LABEL[deal.salesStage] : "Not set"}</div>
          <div className={`mt-0.5 text-caption ${TONE.muted}`}>
            {deal.salesStage ? SALES_STAGE_HELP[deal.salesStage].meaning : "Nobody has set this yet."}
          </div>
        </div>
      </div>
      {stagesDisagree ? (
        <p className="mt-2 text-caption font-semibold text-warning">Check stages: these two do not fit together.</p>
      ) : null}
      {canManage && isOpen ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" disabled={!canChangeStage || stageMutation.isPending} onClick={() => setUpdating(true)} className={PRIMARY}>
            Update stage
          </Button>
          {nextWork ? (
            <Button type="button" variant="ghost" disabled={!canChangeStage || stageMutation.isPending} onClick={moveToNextWorkStage} className={QUIET}>
              Move to the next work stage
            </Button>
          ) : null}
        </div>
      ) : null}
      {movedNote ? <div className="mt-2"><PanelNotice>{movedNote}</PanelNotice></div> : null}

      {stageChanged && !STAGE_LINK_FIELDS[deal.stage] ? (
        <div className="mt-3">
          <PanelNotice>
            Stage changed. Do you want to add a document link for this stage?{" "}
            <a href="?tab=documents" className="font-bold underline">Add a link</a>
          </PanelNotice>
        </div>
      ) : null}

      {asking ? (
        <StageChangeDialog
          deal={deal}
          stage={asking.stage}
          ask={asking.ask}
          canSkipQuote={canSkipQuote}
          salesStage={asking.salesStage}
          onClose={() => setAsking(null)}
          onMoved={() => {
            setAsking(null)
            setStageChanged(true)
            setMovedNote(asking.salesStage ? moveNote("sales", SALES_STAGE_LABEL[asking.salesStage]) : null)
            invalidate()
          }}
        />
      ) : null}

      {updating ? (
        <StageUpdateDialog
          deal={deal}
          canSkipQuote={canSkipQuote}
          onClose={() => setUpdating(false)}
          onMoved={() => { setUpdating(false); setStageChanged(true); setMovedNote(null); invalidate() }}
        />
      ) : null}

      <StageBar status={deal.status} stage={deal.stage} track={deal.track} className="mt-2.5 max-w-[16rem]" />

      {isOpen ? (
        <div className="mt-1.5 text-caption text-ink-muted">
          {daysSince(deal.stageChangedAt)} days in this stage
        </div>
      ) : null}

      <StageLinks deal={deal} canManage={canManage && isOpen} />

      {canManage ? <div className="mt-4 border-t border-line pt-4">
        <Field
          label="Next step"
          htmlFor="next-step"
          help="The one thing that happens next, as a note on the Opportunity. Tick the box below to also make it a task with a reminder."
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
            className="mt-3 h-8 rounded-md bg-ink px-3 text-caption font-bold text-white hover:bg-ink-strong"
          >
            {nextStepMutation.isPending ? "Saving…" : "Save next step"}
          </Button>
      </div> : (
        <div className="mt-4 border-t border-line pt-4">
          <div className={`text-caption font-semibold ${TONE.muted}`}>Next step</div>
          <p className="mt-1 text-body-sm">{deal.nextStep ?? "None set"}</p>
          <div className={`mt-1 text-caption ${TONE.muted}`}>Due {onDate(deal.nextStepDueOn)}</div>
        </div>
      )}
    </Panel>
  )
}
