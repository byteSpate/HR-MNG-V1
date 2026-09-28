"use client"

import { useQuery } from "@tanstack/react-query"

import { getOpportunityHistory } from "@/lib/api/sales/opportunities"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function OpportunityHistoryPanel({ opportunityId }: { opportunityId: string }) {
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
