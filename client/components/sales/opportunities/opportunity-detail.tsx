"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  RiBox3Line,
  RiCalendar2Line,
  RiChat3Line,
  RiErrorWarningLine,
  RiEyeLine,
  RiFileTextLine,
  RiFlagLine,
  RiFolder3Line,
  RiHistoryLine,
  RiMoneyDollarCircleLine,
  RiRouteLine,
  RiTaskLine,
} from "@remixicon/react"

import { getOpportunity } from "@/lib/api/sales/opportunities"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { Tag } from "@/components/dashboard/tag"
import { TONE, toMessage } from "@/components/dashboard/record-kit"
import { OPPORTUNITY_STATUS_LABEL, OPPORTUNITY_STATUS_TONE, stageSentence, taka } from "@/components/sales/shared/sales-shared"
import { MeetingsPanel, TasksPanel } from "@/components/sales/shared/plan-panels"
import { MoneySection } from "@/components/money/money-section"
import { CommentPanel } from "@/components/sales/shared/comment-panel"
import { OpportunityFormDialog } from "@/components/sales/opportunities/opportunity-form-dialog"
import { HandOverDialog } from "@/components/sales/opportunities/handover-dialog"
import { RecordTabs } from "@/components/sales/shared/record-tabs"
import { WorkflowPanel } from "@/components/sales/opportunities/workflow-panel"
import { StatusPanel } from "@/components/sales/opportunities/status-panel"
import { LinesPanel, marginWords, onDate } from "@/components/sales/opportunities/lines-panel"
import { OpportunityProjectPanel } from "@/components/sales/opportunities/opportunity-project-panel"
import { DocumentsPanel } from "@/components/sales/opportunities/documents-panel"
import { OpportunityTimelinePanel } from "@/components/sales/opportunities/opportunity-timeline-panel"
import { OpportunityHistoryPanel } from "@/components/sales/opportunities/opportunity-history-panel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type DealTab = "workflow" | "status" | "products" | "money" | "project" | "documents" | "meetings" | "tasks" | "comments" | "timeline"

/**
 * The Opportunity page: a header card, then one tab per area (spec 2026-09-28
 * §1.2). The open tab lives in `?tab=`, so a link to an Opportunity opens the
 * tab the sender meant and a link with no `?tab` still opens the first one.
 * The Money tab only exists once the Opportunity is Won, because before that
 * there is no money to record.
 */
export function OpportunityDetail({ opportunityId, initialTab }: { opportunityId: string; initialTab: string | null }) {
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
  // Starting a Project is the Opportunity Owner's or a Sales Admin's call.
  // The session carries no employee id, so the button is offered to anyone
  // who can change the Opportunity and the server refuses the rest, word for
  // word, on the Project tab.
  const canStart = canManage
  const [editOpen, setEditOpen] = useState(false)
  const [handOverOpen, setHandOverOpen] = useState(false)

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

            {/* The Hand-over is offered only where it can work: a Networking
                Opportunity that has said it needs software, and has not
                already been handed over. */}
            {(() => {
              const canHandOver =
                canManage && deal.track === "NETWORKING" && deal.softwareNeeded === true && !deal.handedOverTo
              if (!canHandOver) return null
              return (
                <div className="mt-2.5">
                  <Button
                    type="button"
                    onClick={() => setHandOverOpen(true)}
                    className="h-auto rounded-md border border-[#E4E9EF] bg-white px-2.5 py-1.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
                  >
                    Hand software to the Software team
                  </Button>
                </div>
              )
            })()}

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

            {/* The Hand-over link, whichever side of it this Opportunity is on
                (spec §2.5). Exactly one is ever set. */}
            {deal.handedOverTo ? (
              <p className={`mt-1.5 text-[12.5px] ${TONE.muted}`}>
                Software work:{" "}
                <Link
                  href={`/sales/opportunities/${deal.handedOverTo.id}`}
                  className="font-semibold hover:underline"
                >
                  {deal.handedOverTo.serial} {deal.handedOverTo.name}
                </Link>
              </p>
            ) : null}
            {deal.handedOverFrom ? (
              <p className={`mt-1.5 text-[12.5px] ${TONE.muted}`}>
                Handed over from{" "}
                <Link
                  href={`/sales/opportunities/${deal.handedOverFrom.id}`}
                  className="font-semibold hover:underline"
                >
                  {deal.handedOverFrom.serial} {deal.handedOverFrom.name}
                </Link>
              </p>
            ) : null}

            {deal.oemAccountManager ? (
              <div className={`mt-1.5 text-[12.5px] ${TONE.muted}`}>
                OEM contact: {deal.oemAccountManager}
              </div>
            ) : null}

            {!canManage ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-2 text-[12px] leading-relaxed text-[#5F6B7C]">
                <RiEyeLine className="mt-px size-3.5 shrink-0" aria-hidden />
                You can see this Opportunity because its account is shared in All Accounts, but only the
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

          <HandOverDialog deal={deal} open={handOverOpen} onOpenChange={setHandOverOpen} />

          <RecordTabs<DealTab>
            initialTab={initialTab}
            tabs={[
              { value: "workflow", icon: RiRouteLine, label: "Workflow", content: <WorkflowPanel deal={deal} canManage={canManage} /> },
              { value: "status", icon: RiFlagLine, label: "Status", content: <StatusPanel deal={deal} canManage={canManage} isSalesAdmin={isSalesAdmin} /> },
              { value: "products", icon: RiBox3Line, label: deal.track === "SOFTWARE_DEVELOPMENT" ? "Modules" : "Products", content: <LinesPanel deal={deal} canManage={canManage} /> },
              ...(deal.status === "WON" ? [{ value: "money" as const, icon: RiMoneyDollarCircleLine, label: "Money", content: <MoneySection opportunityId={deal.id} /> }] : []),
              { value: "project", icon: RiFolder3Line, label: "Project", content: <OpportunityProjectPanel deal={deal} canStart={canStart} /> },
              { value: "documents", icon: RiFileTextLine, label: "Documents", content: <DocumentsPanel deal={deal} canManage={canManage} /> },
              { value: "meetings", icon: RiCalendar2Line, label: "Meetings", content: <MeetingsPanel accountId={deal.salesAccountId} opportunityId={deal.id} canManage={canManage} /> },
              { value: "tasks", icon: RiTaskLine, label: "Tasks", content: <TasksPanel accountId={deal.salesAccountId} opportunityId={deal.id} canManage={canManage} /> },
              {
                value: "comments",
                icon: RiChat3Line,
                label: "Comments",
                content: (
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
                ),
              },
              {
                value: "timeline",
                icon: RiHistoryLine,
                label: "Timeline History",
                content: (
                  <div className="grid gap-4">
                    <OpportunityTimelinePanel opportunityId={deal.id} />
                    <OpportunityHistoryPanel opportunityId={deal.id} />
                  </div>
                ),
              },
            ]}
          />
        </>
      ) : null}
    </>
  )
}