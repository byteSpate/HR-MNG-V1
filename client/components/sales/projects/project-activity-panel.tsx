"use client"

import { useQuery } from "@tanstack/react-query"

import { listProjectActivity } from "@/lib/api/sales/projects"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { PanelTable } from "@/components/dashboard/record-kit"
import { Skeleton } from "@/components/ui/skeleton"

function at(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

/**
 * What has happened on this Project, newest first (spec §1.7).
 *
 * Read from the Project's audit rows rather than a second list the page keeps
 * up to date, so it cannot disagree with History.
 */
export function ProjectActivityPanel({ projectId }: { projectId: string }) {
  const { accessToken } = useSession()

  const activity = useQuery({
    queryKey: salesKeys.projectActivity(projectId),
    queryFn: () => listProjectActivity(accessToken!, projectId),
    enabled: !!accessToken,
  })

  if (activity.isPending) {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-4 w-52" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-4 w-40" />
      </div>
    )
  }

  if (activity.isError) {
    return (
      <p className="text-[13px] font-semibold text-[#B03A3A]">
        The activity list could not be loaded.
      </p>
    )
  }

  const rows = (activity.data ?? []).map((row) => [
    { node: <span>{row.text}</span> },
    { node: <span>{row.byName ?? "Nobody"}</span> },
    { node: <span>{at(row.at)}</span> },
  ])

  if (rows.length === 0) {
    return <p className="text-[13px]">Nothing has happened yet.</p>
  }

  return (
    <PanelTable
      cols="minmax(0,2fr) minmax(0,1fr) minmax(0,0.8fr)"
      headers={["What happened", "Who", "When"]}
      rows={rows}
      isLoading={false}
      isError={false}
      onRetry={() => activity.refetch()}
      emptyTitle="Nothing has happened yet"
      emptyBody="Changes to this Project will be listed here."
      onEmptyAction={() => activity.refetch()}
    />
  )
}
