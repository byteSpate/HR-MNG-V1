"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"

import { listProjects } from "@/lib/api/sales/projects"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { Skeleton } from "@/components/ui/skeleton"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/components/sales/projects/project-shared"

/** This account's Projects (spec §1.1). Loading, empty and broken are three screens. */
export function AccountProjectsPanel({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const query = useQuery({
    queryKey: salesKeys.projects({ salesAccountId: accountId }),
    queryFn: () => listProjects(accessToken!, { salesAccountId: accountId }),
    enabled: !!accessToken,
  })
  return (
    <Panel>
      <PanelHeading title="Post Activities" />
      {query.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : query.isError ? (
        <PanelAlert>{toMessage(query.error)}</PanelAlert>
      ) : query.data.length === 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>
          No Projects yet. A Project starts from a Won Opportunity, on its Project tab.
        </p>
      ) : (
        <ul className="-mx-2 divide-y divide-[#E4E9EF]">
          {query.data.map((p) => (
            <li key={p.id}>
              {/* The whole row opens the project (owner, 2026-10-18), like the Opportunities tab. */}
              <Link
                href={`/sales/projects/${p.id}`}
                className="flex flex-wrap items-center gap-2 rounded-md px-2 py-2.5 transition-colors hover:bg-[#F7F9FB] focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none"
              >
                <span className="text-[13px] font-semibold">{p.name}</span>
                <span className={`text-[12px] ${TONE.muted}`}>{p.serial} · {p.opportunitySerial} · {p.managerName}</span>
                <Tag label={PROJECT_STATUS_LABEL[p.status]} tone={PROJECT_STATUS_TONE[p.status]} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
