"use client"

/**
 * The side panel for one Opportunity on the Saturday page (owner, 2026-11-02).
 * A click on a funnel row opens this instead of a new page, so the admin keeps
 * their place in the person's week. It shows what the meeting needs: where the
 * Opportunity stands, the quotes it has, the files linked at its stage, what is
 * open on it, and the take-outs about it, with a box to give another.
 */

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { RiExternalLinkLine } from "@remixicon/react"

import { getOpportunity } from "@/lib/api/sales/opportunities"
import { listTakeOuts } from "@/lib/api/sales/funnel"
import { funnelKeys } from "@/lib/api/sales/funnel-keys"
import { listTasks } from "@/lib/api/sales/tasks"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { nextStepParts } from "@/lib/before-quotation"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { StageLinks } from "@/components/sales/opportunities/stage-links"
import { TakeOutBox } from "@/components/sales/funnel/take-out-box"
import { onDay, stageSentence, taka } from "@/components/sales/shared/sales-shared"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export function RowPanel({
  opportunityId,
  employeeId,
  employeeName,
  isAdmin,
  showQuotes,
  onClose,
}: {
  /** Null keeps the panel closed. */
  opportunityId: string | null
  /** Whose funnel it is: take-outs are listed and given for this person. */
  employeeId: string
  employeeName: string
  isAdmin: boolean
  /** Quotes show in the Quoted view only. Before Quotation has none. */
  showQuotes: boolean
  onClose: () => void
}) {
  const { accessToken } = useSession()
  const enabled = !!accessToken && !!opportunityId

  const deal = useQuery({
    queryKey: salesKeys.opportunity(opportunityId ?? ""),
    queryFn: () => getOpportunity(accessToken!, opportunityId!),
    enabled,
  })
  const tasks = useQuery({
    queryKey: salesKeys.tasks({ opportunityId, panel: true }),
    queryFn: () => listTasks(accessToken!, { opportunityId: opportunityId!, status: "PENDING" }),
    enabled,
  })
  const takeOuts = useQuery({
    queryKey: funnelKeys.takeOuts(employeeId, opportunityId ?? ""),
    queryFn: () => listTakeOuts({ employeeId, opportunityId: opportunityId! }, accessToken!),
    enabled,
  })

  const data = deal.data
  const next = data ? nextStepParts(data) : null

  return (
    <Sheet open={!!opportunityId} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{data?.name ?? "Opportunity"}</SheetTitle>
          <SheetDescription>{data ? `${data.serial} · ${data.salesAccountName}` : "Loading the Opportunity"}</SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4 pb-6">
          {deal.isError ? (
            <PanelAlert>{toMessage(deal.error)}</PanelAlert>
          ) : !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-caption">
                <dt className={TONE.muted}>Stage</dt>
                <dd className="font-semibold">{stageSentence(data.status, data.stage)}</dd>
                <dt className={TONE.muted}>Owner</dt>
                <dd>{data.ownerName}</dd>
                <dt className={TONE.muted}>Next step</dt>
                <dd>{next?.text ? `${next.text}${next.dueOn ? `, ${onDay(next.dueOn)}` : ""}` : <span className={TONE.muted}>No next step</span>}</dd>
                <dt className={TONE.muted}>Quote planned</dt>
                <dd>{data.expectedQuoteOn ? onDay(data.expectedQuoteOn) : <span className={TONE.muted}>Not set</span>}</dd>
              </dl>

              {showQuotes ? (
                <div>
                  <h4 className="mb-1 text-caption font-bold">Quotes</h4>
                  {data.quotes.length === 0 ? (
                    <p className={cn("text-caption", TONE.muted)}>No quote yet.</p>
                  ) : (
                    <ul className="grid gap-1 text-caption">
                      {data.quotes.map((quote, index) => (
                        <li key={quote.id} className="flex flex-wrap justify-between gap-2">
                          <span>{`Quote ${data.quotes.length - index}`}</span>
                          <span className="tabular-nums">{`${taka(quote.amount)} on ${onDay(quote.quotedOn)}`}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              <StageLinks deal={data} canManage={isAdmin} />

              <div>
                <h4 className="mb-1 text-caption font-bold">Open tasks</h4>
                {tasks.isError ? (
                  <PanelAlert>{toMessage(tasks.error)}</PanelAlert>
                ) : tasks.isPending ? (
                  <Skeleton className="h-10 w-full" />
                ) : (tasks.data?.items ?? []).length === 0 ? (
                  <p className={cn("text-caption", TONE.muted)}>Nothing open on this Opportunity.</p>
                ) : (
                  <ul className="grid gap-1 text-caption">
                    {(tasks.data?.items ?? []).map((task) => (
                      <li key={task.id} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{task.title}</span>
                        <span className={cn("tabular-nums", TONE.muted)}>{onDay(task.dueOn)}</span>
                        {task.overdue ? <Tag label="Overdue" tone="red" /> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="mb-1 text-caption font-bold">Take-outs for {employeeName}</h4>
                {takeOuts.isError ? (
                  <PanelAlert>{toMessage(takeOuts.error)}</PanelAlert>
                ) : takeOuts.isPending ? (
                  <Skeleton className="h-10 w-full" />
                ) : (takeOuts.data?.items ?? []).length === 0 ? (
                  <p className={cn("text-caption", TONE.muted)}>No take-out on this Opportunity yet.</p>
                ) : (
                  <ul className="grid gap-1 text-caption">
                    {(takeOuts.data?.items ?? []).map((task) => (
                      <li key={task.id}>
                        <span className="font-semibold [overflow-wrap:anywhere]">{task.title}</span>
                        <span className={cn("block text-caption", TONE.muted)}>
                          {`${task.givenByName ?? "An admin"}, ${task.givenOn ? onDay(task.givenOn) : ""} · ${task.status === "DONE" ? "Done" : `due ${onDay(task.dueOn)}`}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {isAdmin ? (
                  <div className="mt-2">
                    <TakeOutBox employeeId={employeeId} employeeName={employeeName} opportunityId={data.id} />
                  </div>
                ) : null}
              </div>

              <Link
                href={`/sales/opportunities/${data.id}`}
                className="inline-flex items-center gap-1 text-caption font-bold hover:underline"
              >
                Open the Opportunity
                <RiExternalLinkLine className="size-3.5" aria-hidden />
              </Link>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
