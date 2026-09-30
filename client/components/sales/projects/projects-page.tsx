"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import {
  RiAlarmWarningLine,
  RiCalendar2Line,
  RiErrorWarningLine,
  RiFolder3Line,
  RiPauseCircleLine,
  RiPlayCircleLine,
} from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"

import { listProjects } from "@/lib/api/sales/projects"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { ProjectListRow, SalesTrack } from "@/lib/api/types"
import {
  dayText, daysLeftText, filterByHealth, HEALTH_LABEL, HEALTH_TONE, listEmptyState,
  overviewScope, overviewStats, progressText, quietText, type ProjectHealth,
} from "@/lib/project-overview"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable, TONE } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { sized } from "@/components/sales/shared/sized-cell"
import { SalesStatRow, type SalesStat } from "@/components/sales/shared/stat-row"
import { TRACKS, TRACK_LABEL } from "@/lib/api/sales/stages"
import type { TableCell } from "@/components/dashboard/types"
import {
  PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, PROJECT_STATUSES,
} from "@/components/sales/projects/project-shared"

const HEALTHS: ProjectHealth[] = ["ON_TRACK", "AT_RISK", "LATE"]

function rowCells(p: ProjectListRow): TableCell[] {
  const href = `/sales/projects/${p.id}`
  const quiet = quietText(p.quietDays)
  return [
    {
      node: (
        <Link href={href} className="block w-full cursor-pointer">
          <span className="block truncate font-semibold">{p.name}</span>
          <span className="block truncate font-mono text-[11.5px] text-[#6B7789]">
            {p.serial} · {p.opportunitySerial} · {TRACK_LABEL[p.track] ?? p.track}
          </span>
        </Link>
      ),
    },
    { node: <span className="block truncate">{p.salesAccountName}</span> },
    { node: <span className="block truncate">{p.managerName}</span> },
    {
      node: (
        <div className="min-w-0">
          <Tag label={PROJECT_STATUS_LABEL[p.status]} tone={PROJECT_STATUS_TONE[p.status]} />
          {quiet ? <div className="mt-0.5 text-[11.5px] font-semibold text-[#8A5E0C]">{quiet}</div> : null}
        </div>
      ),
    },
    // No health for a Project that is finished, cancelled or not started: the
    // server sends null and a dash says so, rather than a made-up "On track".
    p.health
      ? { tag: HEALTH_LABEL[p.health], tone: HEALTH_TONE[p.health] }
      : { node: <span className={TONE.muted}>—</span> },
    {
      node: (
        <span className={p.progressPercent === null ? TONE.muted : undefined}>{progressText(p.progressPercent)}</span>
      ),
    },
    {
      node: (
        <div className="min-w-0">
          <span className={p.daysLeft !== null && p.daysLeft < 0 ? "font-semibold text-[#B03A3A]" : undefined}>
            {daysLeftText(p.daysLeft, p.status)}
          </span>
          <div className={`text-[11.5px] ${TONE.muted}`}>{dayText(p.dueOn)}</div>
        </div>
      ),
    },
    {
      node: (
        <span>
          {p.openTasks}
          {p.lateTasks > 0 ? <span className="font-semibold text-[#B03A3A]"> · {p.lateTasks} late</span> : null}
        </span>
      ),
    },
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
 * Every Project the viewer may see, newest first (spec 2026-09-28 §1.8, and
 * 2026-09-30 for the overview). The scope is the account scope the server
 * already applies: a Project is not a wider directory than its Opportunity.
 *
 * Health, progress, days left and quiet days all come from the server, so this
 * table and a Project's Overview tab always say the same thing. The Health
 * filter works on the rows already loaded, because health is worked out from
 * each Project's tasks and is not a column the server can filter on.
 */
export function ProjectsPage() {
  const { accessToken } = useSession()
  const [status, setStatus] = useState<string>("")
  const [track, setTrack] = useState<string>("")
  const [health, setHealth] = useState<string>("")

  const filters = {
    ...(status ? { status: status as ProjectListRow["status"] } : {}),
    ...(track ? { track: track as SalesTrack } : {}),
  }
  const query = useQuery({
    queryKey: salesKeys.projects(filters),
    queryFn: () => listProjects(accessToken!, filters),
    enabled: !!accessToken,
  })

  const isFiltered = status !== "" || track !== "" || health !== ""
  const empty = listEmptyState(isFiltered)

  // Counted from the rows on the table, so a tile always agrees with it. The
  // server sends at most 200, and the tiles say so at that point.
  const loaded = useMemo(() => query.data ?? [], [query.data])
  const projects = useMemo(() => filterByHealth(loaded, health), [loaded, health])
  const stats = useMemo<SalesStat[]>(() => {
    const c = overviewStats(projects)
    const scope = overviewScope(loaded.length)
    return [
      { label: "Active", value: String(c.active), sub: `Work is moving. ${scope}.`, icon: RiPlayCircleLine },
      { label: "Late", value: String(c.late), sub: "Past a date they owed", icon: RiAlarmWarningLine },
      { label: "At risk", value: String(c.atRisk), sub: "A task is due within 3 days", icon: RiErrorWarningLine },
      { label: "Blocked", value: String(c.blocked), sub: "Waiting on something", icon: RiPauseCircleLine },
      { label: "Due this week", value: String(c.dueThisWeek), sub: "Finish date in the next 7 days", icon: RiCalendar2Line },
    ]
  }, [projects, loaded.length])

  const selectClass =
    "h-9 rounded-md border border-[#E4E9EF] bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#17191C]/20"

  return (
    <>
      <PageHeader kicker="Sales" title="Projects" sub="Delivery work for Won Opportunities." />

      <SalesStatRow stats={stats} isLoading={query.isPending} isError={query.isError} />

      {/* Hidden while the first page loads (UI rule 4): a filter that appears
          after the data and changes it under the reader is a jump, not a
          control. */}
      {!query.isPending ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="project-status" className={`text-[12px] font-semibold ${TONE.muted}`}>
            Status
          </label>
          <select id="project-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
            <option value="">All</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>

          <label htmlFor="project-health" className={`ml-3 text-[12px] font-semibold ${TONE.muted}`}>
            Health
          </label>
          <select id="project-health" value={health} onChange={(e) => setHealth(e.target.value)} className={selectClass}>
            <option value="">All</option>
            {HEALTHS.map((h) => (
              <option key={h} value={h}>
                {HEALTH_LABEL[h]}
              </option>
            ))}
          </select>

          <label htmlFor="project-track" className={`ml-3 text-[12px] font-semibold ${TONE.muted}`}>
            Track
          </label>
          <select id="project-track" value={track} onChange={(e) => setTrack(e.target.value)} className={selectClass}>
            <option value="">All</option>
            {TRACKS.map((t) => (
              <option key={t} value={t}>
                {TRACK_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <PanelTable
        title="Delivery work"
        emptyIcon={RiFolder3Line}
        cols="minmax(0,2.2fr) minmax(0,1.2fr) minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,0.9fr) minmax(0,0.9fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,0.8fr)"
        headers={["Project", "Account", "Project Manager", "Status", "Health", "Progress", "Days left", "Open tasks", "Milestones"]}
        rows={projects.map((p) => rowCells(p).map(sized))}
        isLoading={query.isPending}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={empty.title}
        emptyBody={empty.body}
        emptyAction={empty.action ?? undefined}
        onEmptyAction={() => {
          setStatus("")
          setTrack("")
          setHealth("")
        }}
      />
    </>
  )
}
