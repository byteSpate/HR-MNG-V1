"use client"

import Link from "next/link"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { listProjects } from "@/lib/api/sales/projects"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { ProjectListRow } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable, TONE } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import {
  PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, PROJECT_STATUSES,
} from "@/components/sales/projects/project-shared"

/** Date-only, read as written. A finish date is a calendar day, not an instant. */
function onDate(value: string | null): string {
  if (!value) return "Not set"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

function rowCells(p: ProjectListRow): TableCell[] {
  const href = `/sales/projects/${p.id}`
  return [
    {
      node: (
        <Link href={href} className="block w-full cursor-pointer">
          <span className="block truncate font-semibold">{p.name}</span>
          <span className="block font-mono text-[11.5px] text-[#6B7789]">{p.serial}</span>
        </Link>
      ),
    },
    { node: <span className="block truncate">{p.salesAccountName}</span> },
    { node: <span className="font-mono text-[11.5px] text-[#6B7789]">{p.opportunitySerial}</span> },
    { node: <span className="block truncate">{p.managerName}</span> },
    { tag: PROJECT_STATUS_LABEL[p.status], tone: PROJECT_STATUS_TONE[p.status] },
    { node: <span>{onDate(p.dueOn)}</span> },
    {
      node: (
        <span className={p.milestonesTotal === 0 ? TONE.muted : undefined}>
          {p.milestonesTotal === 0 ? "None" : `${p.milestonesDone} of ${p.milestonesTotal}`}
        </span>
      ),
    },
  ]
}

/**
 * Every Project the viewer may see, newest first (spec 2026-09-28 §1.8). The
 * scope is the account scope the server already applies: a Project is not a
 * wider directory than its Opportunity.
 */
export function ProjectsPage() {
  const { accessToken } = useSession()
  const [status, setStatus] = useState<string>("")

  const query = useQuery({
    queryKey: salesKeys.projects(status ? { status } : {}),
    queryFn: () => listProjects(accessToken!, status ? { status: status as ProjectListRow["status"] } : {}),
    enabled: !!accessToken,
  })

  const isFiltered = status !== ""

  return (
    <>
      <PageHeader kicker="Sales" title="Projects" sub="Delivery work for Won Opportunities." />

      {/* Hidden while the first page loads (UI rule 4): a filter that appears
          after the data and changes it under the reader is a jump, not a
          control. */}
      {!query.isPending ? (
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="project-status" className={`text-[12px] font-semibold ${TONE.muted}`}>
            Status
          </label>
          <select
            id="project-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-[#E4E9EF] bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#17191C]/20"
          >
            <option value="">All</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <PanelTable
        cols="minmax(0,2fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1fr) auto minmax(0,1fr) minmax(0,0.8fr)"
        headers={["Project", "Account", "Opportunity", "Project Manager", "Status", "Finish date", "Milestones"]}
        rows={(query.data ?? []).map(rowCells)}
        isLoading={query.isPending}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={isFiltered ? "No Projects have this status" : "No Projects yet"}
        emptyBody={
          isFiltered
            ? "Try a different status, or All."
            : "A Project starts from a Won Opportunity, on its Project tab."
        }
        emptyAction={isFiltered ? "Clear the filter" : undefined}
        onEmptyAction={() => setStatus("")}
      />
    </>
  )
}
