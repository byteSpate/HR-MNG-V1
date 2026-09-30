"use client"

import {
  RiBookOpenLine,
  RiBox3Line,
  RiDashboardLine,
  RiInformationLine,
  RiPulseLine,
  RiTaskLine,
} from "@remixicon/react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { getProject } from "@/lib/api/sales/projects"
import { projectWriteKeys, salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { ProjectSummary } from "@/lib/api/types"
import { TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { RecordTabs } from "@/components/sales/shared/record-tabs"
import { ProjectOverviewTab } from "@/components/sales/projects/project-overview-tab"
import { ProjectDetailsTab } from "@/components/sales/projects/project-details-tab"
import { ProjectProductsTab } from "@/components/sales/projects/project-products-tab"
import { ProjectTasksTab } from "@/components/sales/projects/project-tasks-tab"
import { ProjectDailyLogTab } from "@/components/sales/projects/project-daily-log-tab"
import { ProjectStatusTab } from "@/components/sales/projects/project-status-tab"
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/components/sales/projects/project-shared"
import { Skeleton } from "@/components/ui/skeleton"

type ProjectTab = "overview" | "details" | "products" | "status" | "tasks" | "daily-log"

/**
 * The Project page (spec 2026-09-28 §1.7, §1.9, and 2026-09-30): a header
 * card, then Overview, Details, Products and Status. Every write on this page
 * returns the whole `ProjectSummary`, so the open Project is set from the
 * response rather than refetched; the lists and the Opportunity's page still
 * need invalidating.
 */
export function ProjectDetail({ projectId, initialTab }: { projectId: string; initialTab: string | null }) {
  const { accessToken, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: salesKeys.project(projectId),
    queryFn: () => getProject(accessToken!, projectId),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  const project = query.data

  /** Every write ends here: take the server's answer as the page's truth. */
  const onSaved = (updated: ProjectSummary) => {
    queryClient.setQueryData(salesKeys.project(updated.id), updated)
    for (const key of projectWriteKeys(updated.id, updated.opportunity.id)) {
      queryClient.invalidateQueries({ queryKey: key })
    }
  }

  return (
    <>
      <div className="pt-7 pb-4">
        <Link href="/sales/projects" className="text-[12.5px] font-semibold text-[#5F6B7C] hover:underline">
          ← Projects
        </Link>
      </div>

      {sessionStatus === "loading" || query.isPending ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2.5 h-3.5 w-64" />
        </div>
      ) : query.isError ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-8 text-center">
          <span className="mx-auto mb-2.5 flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <span aria-hidden>!</span>
          </span>
          {/* Verbatim: "That Project does not exist, or is not yours" already
              says the right thing. */}
          <p className="text-[13px] font-semibold text-[#B03A3A]">{toMessage(query.error)}</p>
        </div>
      ) : project ? (
        <>
          <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className={`font-mono text-[12px] ${TONE.muted}`}>{project.serial}</span>
              <h1 className="font-heading text-[21px] font-bold tracking-tight">{project.name}</h1>
              <Tag label={PROJECT_STATUS_LABEL[project.status]} tone={PROJECT_STATUS_TONE[project.status]} />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-[#5F6B7C]">
              <Link href={`/sales/accounts/${project.salesAccount.id}`} className="font-semibold hover:underline">
                {project.salesAccount.name}
              </Link>
              <Link href={`/sales/opportunities/${project.opportunity.id}`} className="font-semibold hover:underline">
                {project.opportunity.serial}
              </Link>
              <span>Project Manager: {project.manager.fullName}</span>
            </div>
            {/* Louder than a muted note: a manager who can no longer work the
                account cannot approve the Project's own work either. */}
            {!project.manager.onAccount ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3 py-2 text-[12px] leading-relaxed text-[#8A5E0C]">
                <span aria-hidden>{project.manager.fullName}</span> is no longer on this account. Choose a new Project
                Manager.
              </p>
            ) : null}
          </div>

          <RecordTabs<ProjectTab>
            initialTab={initialTab}
            tabs={[
              { value: "overview", icon: RiDashboardLine, label: "Overview", content: <ProjectOverviewTab project={project} /> },
              { value: "details", icon: RiInformationLine, label: "Details", content: <ProjectDetailsTab project={project} onSaved={onSaved} /> },
              { value: "products", icon: RiBox3Line, label: project.opportunity.track === "SOFTWARE_DEVELOPMENT" ? "Modules" : "Products", content: <ProjectProductsTab project={project} onSaved={onSaved} /> },
              { value: "status", icon: RiPulseLine, label: "Status", content: <ProjectStatusTab project={project} onSaved={onSaved} /> },
              { value: "tasks", icon: RiTaskLine, label: "Tasks", content: <ProjectTasksTab project={project} /> },
              { value: "daily-log", icon: RiBookOpenLine, label: "Daily Log", content: <ProjectDailyLogTab project={project} /> },
            ]}
          />
        </>
      ) : null}
    </>
  )
}
