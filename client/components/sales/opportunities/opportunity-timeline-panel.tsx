"use client"

import { useQuery } from "@tanstack/react-query"
import { RiFlashlightLine } from "@remixicon/react"

import { getOpportunityTimeline } from "@/lib/api/sales/opportunities"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { MEETING_ICON, TASK_ICON } from "@/components/sales/shared/sales-shared"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function OpportunityTimelinePanel({ opportunityId }: { opportunityId: string }) {
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
