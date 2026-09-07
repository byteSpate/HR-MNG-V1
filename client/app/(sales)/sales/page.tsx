import Link from "next/link"

import { PageHeader } from "@/components/dashboard/page-header"
import { PanelNotice } from "@/components/dashboard/record-kit"

export default function SalesHubPage() {
  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Sales Hub"
        sub="Accounts, contacts and the communication log for the sales team."
      />
      <PanelNotice>
        There is no dashboard here yet — stats and a pipeline view arrive with
        Phase 2.{" "}
        <Link href="/sales/accounts" className="font-bold underline">
          Go to Accounts
        </Link>{" "}
        to see who owns what, and to add or verify a contact.
      </PanelNotice>
    </>
  )
}
