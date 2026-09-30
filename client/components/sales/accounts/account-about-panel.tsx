"use client"

import {
  RiBuilding2Line,
  RiFlagLine,
  RiGlobalLine,
  RiGroupLine,
  RiMapPinLine,
  RiMessage2Line,
  RiUserStarLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import type { SalesAccountSummary } from "@/lib/api/types"
import { TONE } from "@/components/dashboard/record-kit"
import { ACCOUNT_STATUS_LABEL } from "@/components/sales/shared/sales-shared"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { CompanyProfilePanel } from "@/components/sales/accounts/company-profile-panel"

/**
 * What the app knows about this account that is not a person or a list of
 * things: one row per fact, with "Not recorded" rather than a blank, so an
 * empty field never reads as an oversight rather than a choice.
 */
export function AccountAboutPanel({ account }: { account: SalesAccountSummary }) {
  const rows: { label: string; value: string; icon: RemixiconComponentType }[] = [
    { label: "Owner", value: account.ownerName, icon: RiUserStarLine },
    {
      label: "Collaborators",
      value: account.assignees.length > 0 ? account.assignees.map((a) => a.fullName).join(", ") : "None",
      icon: RiGroupLine,
    },
    { label: "Industry", value: account.industry || "Not recorded", icon: RiBuilding2Line },
    { label: "Website", value: account.website || "Not recorded", icon: RiGlobalLine },
    { label: "Address", value: account.address || "Not recorded", icon: RiMapPinLine },
    { label: "Status", value: ACCOUNT_STATUS_LABEL[account.status], icon: RiFlagLine },
  ]
  if (account.statusReason) rows.push({ label: "Status reason", value: account.statusReason, icon: RiMessage2Line })

  return (
    <div className="grid gap-4">
      {/* The visiting card is not here. It holds the contact details of the
          person the team met, so it lives on the Contacts tab. */}
      <Panel>
      <PanelHeading title="About" />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 text-[13px] sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start gap-2.5">
            <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-md bg-[#F1F4F8] text-[#5F6B7C]">
              <row.icon className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <dt className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>{row.label}</dt>
              <dd className="font-semibold [overflow-wrap:anywhere]">{row.value}</dd>
            </div>
          </div>
        ))}
      </dl>
      </Panel>

      <CompanyProfilePanel accountId={account.id} />
    </div>
  )
}
