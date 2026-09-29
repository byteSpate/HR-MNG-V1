"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { tickProjectLine, untickProjectLine } from "@/lib/api/sales/projects"
import { useSession } from "@/lib/auth/session-context"
import type { ProjectSummary } from "@/lib/api/types"
import { PanelAlert, PanelTable, TONE, toMessage } from "@/components/dashboard/record-kit"
import { taka } from "@/components/sales/shared/sales-shared"
import { Checkbox } from "@/components/ui/checkbox"

function onDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

/**
 * The Opportunity's own products, seen from the Project (spec §1.7). The lines
 * are never copied: this is a read of the Opportunity's lines with a Done tick
 * beside each, so a price typed on the Opportunity shows here at once.
 */
export function ProjectProductsTab({ project, onSaved }: { project: ProjectSummary; onSaved: (p: ProjectSummary) => void }) {
  const { accessToken } = useSession()
  const [error, setError] = useState<string | null>(null)

  const tick = useMutation({
    mutationFn: ({ lineId, on }: { lineId: string; on: boolean }) =>
      on ? tickProjectLine(accessToken!, project.id, lineId) : untickProjectLine(accessToken!, project.id, lineId),
    onSuccess: (p) => { setError(null); onSaved(p) },
    onError: (err) => setError(toMessage(err)),
  })

  // A price column only when at least one line has one. A column of "No price
  // yet" is a column that says nothing.
  const anyPriced = project.lines.some((l) => l.lineValue !== null)

  const rows = project.lines.map((l) => [
    {
      node: (
        <span className="block min-w-0">
          <span className="block truncate font-semibold">{l.product}</span>
          {l.model ? <span className="block truncate text-[11.5px] text-[#6B7789]">{l.model}</span> : null}
        </span>
      ),
    },
    { node: <span className={l.oemBrand ? undefined : TONE.muted}>{l.oemBrand ?? "Not set"}</span> },
    { node: <span className={l.quantity === null ? TONE.muted : undefined}>{l.quantity ?? "Not set"}</span> },
    { node: <span className={l.supplierName ? undefined : TONE.muted}>{l.supplierName ?? "Not set"}</span> },
    ...(anyPriced
      ? [{ node: <span>{l.lineValue ? taka(l.lineValue) : <span className={TONE.muted}>No price yet</span>}</span> }]
      : []),
    project.canTick
      ? {
          node: (
            <span className="flex items-center gap-1.5">
              <Checkbox
                aria-label={`${l.product} done`}
                checked={l.done !== null}
                disabled={tick.isPending}
                onCheckedChange={(v) => tick.mutate({ lineId: l.id, on: v === true })}
              />
              {l.done ? <span className={`text-[11.5px] ${TONE.muted}`}>{onDate(l.done.at)}</span> : null}
            </span>
          ),
        }
      : {
          node: l.done ? (
            <span>Done {onDate(l.done.at)} by {l.done.byName ?? "someone"}</span>
          ) : (
            <span className={TONE.muted}>Not done</span>
          ),
        },
  ])

  return (
    <div>
      {error ? <PanelAlert>{error}</PanelAlert> : null}
      <p className={`mb-3 text-[12.5px] ${TONE.muted}`}>
        These are the Opportunity&apos;s own products. To change a product, edit it on the{" "}
        <Link href={`/sales/opportunities/${project.opportunity.id}?tab=products`} className="font-semibold text-[#17191C] underline">
          Opportunity
        </Link>
        .
      </p>
      <PanelTable
        cols="minmax(0,2fr) minmax(0,1fr) minmax(0,0.6fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,1.2fr)"
        headers={["Product", "OEM", "Quantity", "Supplier", ...(anyPriced ? ["Total price"] : []), "Done"]}
        rows={rows}
        isLoading={false}
        isError={false}
        onRetry={() => tick.reset()}
        emptyTitle="No products yet"
        emptyBody="The Opportunity has no products yet."
        // Nothing on this list can be created from here: a product belongs to
        // the Opportunity, so an empty state has nowhere to send anybody.
        onEmptyAction={() => tick.reset()}
      />
    </div>
  )
}
