"use client"

import { useState } from "react"
import { RiFlashlightLine } from "@remixicon/react"

import { OpportunityFormDialog } from "@/components/sales/opportunities/opportunity-form-dialog"
import { useSalesPermissions } from "@/components/sales/shared/use-sales-permissions"
import { Button } from "@/components/ui/button"

/**
 * "Start an Opportunity" on a Green product (owner, 2026-10-18). Used on the
 * board's Green cards and inside an opened Green row, so the two can never
 * differ. The caller shows it only to people who may change the account; the
 * Sales Admin's switch for Opportunities is still read here.
 */
export function HeatmapStartButton({ accountId, productTitle }: { accountId: string; productTitle: string }) {
  const { can } = useSalesPermissions()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        disabled={!can("opportunity.create")}
        title={can("opportunity.create") ? undefined : "A Sales Admin has turned this off for Sales Users."}
        onClick={() => setOpen(true)}
        className="h-auto gap-1.5 rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
      >
        <RiFlashlightLine className="size-3.5" aria-hidden />
        Start an Opportunity
      </Button>
      <OpportunityFormDialog accountId={accountId} open={open} onOpenChange={setOpen} suggestedName={`New ${productTitle}`} />
    </>
  )
}
