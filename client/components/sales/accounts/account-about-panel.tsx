"use client"

import type { SalesAccountSummary } from "@/lib/api/types"
import { CommentPanel } from "@/components/sales/shared/comment-panel"
import { TONE } from "@/components/dashboard/record-kit"
import { ACCOUNT_STATUS_LABEL } from "@/components/sales/shared/sales-shared"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"

/**
 * What the app knows about this account that is not a person or a list of
 * things: one row per fact, with "Not recorded" rather than a blank, so an
 * empty field never reads as an oversight rather than a choice.
 */
export function AccountAboutPanel({
  account,
  isSalesAdmin,
}: {
  account: SalesAccountSummary
  isSalesAdmin: boolean
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Owner", value: account.ownerName },
    {
      label: "Collaborators",
      value: account.assignees.length > 0 ? account.assignees.map((a) => a.fullName).join(", ") : "None",
    },
    { label: "Industry", value: account.industry || "Not recorded" },
    { label: "Website", value: account.website || "Not recorded" },
    { label: "Address", value: account.address || "Not recorded" },
    { label: "Status", value: ACCOUNT_STATUS_LABEL[account.status] },
  ]
  if (account.statusReason) rows.push({ label: "Status reason", value: account.statusReason })

  return (
    <div className="grid gap-4">
      <Panel>
      <PanelHeading title="About" />
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-wrap items-baseline gap-x-2">
            <dt className={TONE.muted}>{row.label}</dt>
            <dd className="font-semibold">{row.value}</dd>
          </div>
        ))}
      </dl>
      </Panel>

      {/* "Remarks" here and "Comments" on an Opportunity, from one component.
          That is the business's own vocabulary and the two labels must not be
          made consistent with each other. */}
      <CommentPanel
        entity="SALES_ACCOUNT"
        entityId={account.id}
        label="Remarks"
        // Customer feedback is offered on an Opportunity only: feedback is
        // always about a specific Opportunity, and the server no longer
        // refuses the row, so the restriction lives here.
        kinds={isSalesAdmin ? ["GENERAL", "MANAGEMENT_NOTE"] : ["GENERAL"]}
        canWrite={account.canManage}
      />
    </div>
  )
}
