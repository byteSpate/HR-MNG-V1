"use client"

import type { SalesAccountSummary } from "@/lib/api/types"
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
      {/* Management notes are admin-only to write. The server refuses either
          way; hiding the option keeps a control that cannot act off screen. */}
      <p className={`mt-3 text-[11.5px] ${TONE.muted}`}>
        {isSalesAdmin
          ? "As a Sales Admin you can add a management note as a Remark."
          : "Remarks are open to the account's owner, its collaborators and a Sales Admin."}
      </p>
    </Panel>
  )
}
