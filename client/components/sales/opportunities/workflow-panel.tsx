"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  changeOpportunityNextStep, changeOpportunityStage,
} from "@/lib/api/sales/opportunities"
import { opportunityWriteKeys, planWriteKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunityStage, OpportunitySummary } from "@/lib/api/types"
import { CheckboxField, Field, PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { OPPORTUNITY_STATUS_LABEL, STAGE_LABEL, STAGE_WAITING_ON, daysSince } from "@/components/sales/shared/sales-shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

/** The stages, in the order the bar draws them. */
const STAGES = Object.keys(STAGE_LABEL) as OpportunityStage[]
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { StageBar } from "@/components/sales/opportunities/stage-bar"
import { onDate } from "@/components/sales/opportunities/lines-panel"

/**
 * Stage and next step. The status itself moved to the Status tab: it is a
 * decision with a reason and a confirm dialog, and it does not belong beside
 * a dropdown that moves the Opportunity along day to day.
 */
export function WorkflowPanel({ deal, canManage }: { deal: OpportunitySummary; canManage: boolean }) {
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

  const isOpen = deal.status === "ONGOING"
  const invalidate = () => {
    for (const key of opportunityWriteKeys(deal.id)) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const stageMutation = useMutation({
    mutationFn: (stage: OpportunityStage) => changeOpportunityStage(accessToken!, deal.id, stage),
    onSuccess: () => { setStageChanged(true); invalidate() },
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
          hint={isOpen ? STAGE_WAITING_ON[deal.stage] : `This Opportunity is ${OPPORTUNITY_STATUS_LABEL[deal.status].toLowerCase()}, so its stage stays where it ended.`}
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

      {stageChanged ? (
        <div className="mt-3">
          <PanelNotice>
            Stage changed. Do you want to add a document link for this stage?{" "}
            <a href="?tab=documents" className="font-bold underline">Add a link</a>
          </PanelNotice>
        </div>
      ) : null}

      <StageBar status={deal.status} stage={deal.stage} className="mt-2.5 max-w-[16rem]" />

      {isOpen ? (
        <div className="mt-1.5 text-[11.5px] text-[#6B7789]">
          {daysSince(deal.stageChangedAt)} days in this stage
        </div>
      ) : null}

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
