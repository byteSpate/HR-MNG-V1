"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { startProject } from "@/lib/api/sales/projects"
import { opportunityWriteKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunitySummary } from "@/lib/api/types"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/components/sales/projects/project-shared"
import { Button } from "@/components/ui/button"

/** Start the Project for a Won Opportunity, or show the one it has (spec §1.7). */
export function OpportunityProjectPanel({ deal, canStart }: { deal: OpportunitySummary; canStart: boolean }) {
  const { accessToken } = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const start = useMutation({
    mutationFn: () => startProject(accessToken!, deal.id),
    onSuccess: (p) => {
      for (const key of opportunityWriteKeys(deal.id)) queryClient.invalidateQueries({ queryKey: key })
      router.push(`/sales/projects/${p.id}`)
    },
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Panel>
      <PanelHeading title="Project" />
      {error ? <PanelAlert>{error}</PanelAlert> : null}
      {deal.project ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/sales/projects/${deal.project.id}`} className="text-[13px] font-semibold hover:underline">
            {deal.project.name}
          </Link>
          <span className={`text-[12px] ${TONE.muted}`}>{deal.project.serial}</span>
          <Tag label={PROJECT_STATUS_LABEL[deal.project.status]} tone={PROJECT_STATUS_TONE[deal.project.status]} />
        </div>
      ) : deal.status !== "WON" ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>A Project can start once this Opportunity is Won.</p>
      ) : canStart ? (
        <div className="space-y-2">
          <p className={`text-[12.5px] ${TONE.muted}`}>
            Start a Project if this Opportunity needs delivery work, such as install or setup. A sale with no delivery work does not need one.
          </p>
          <Button type="button" disabled={start.isPending} onClick={() => start.mutate()} className="h-8 bg-[#17191C] text-[12px] font-bold text-white hover:bg-[#0E1012]">
            {start.isPending ? "Starting…" : "Start project"}
          </Button>
        </div>
      ) : (
        <p className={`text-[12.5px] ${TONE.muted}`}>No Project yet. The Opportunity Owner or a Sales Admin can start one.</p>
      )}
    </Panel>
  )
}
