"use client"

import { useQuery } from "@tanstack/react-query"

import { listAssets } from "@/lib/api/assets"
import { useSession } from "@/lib/auth/session-context"
import { formatAssetDate } from "@/components/asset/asset-shared"
import { Tag } from "@/components/dashboard/tag"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * "What they're holding" on the employee detail page. There is no
 * per-employee holdings endpoint, so this reuses `listAssets` — already
 * scoped server-side by `assetScopeFor` (a Reporting Manager only ever gets
 * back their own reports' open custody, matching `/manager/team/[id]`) — and
 * filters to this one employee's `heldBy` client-side.
 *
 * No cost fields, deliberately: this card renders on the manager route too,
 * and `Asset` omits `purchaseCost`/`vendor` for that role at the source, so
 * there is nothing here that could leak them even by accident.
 *
 * ## Why this is a list and not a table
 *
 * It was a five-column table — tag, name, category, assigned, status. This
 * card sits in `repeat(auto-fit, minmax(310px, 1fr))` alongside the field
 * cards, so its real width is often around 310px, and five columns do not fit
 * in 310px. shadcn's `Table` wraps itself in `overflow-x-auto`, so instead of
 * looking broken it scrolled sideways — which is worse, because a column you
 * have to drag into view is one nobody reads. "Unacknowledged" was in the last
 * column, permanently off-screen.
 *
 * Narrowing the columns would not have helped: an asset tag and a date cannot
 * usefully shrink, and truncating a name to "MacBook Pro 1…" loses the one
 * thing that identifies which machine it is.
 *
 * So each asset is a small block instead. Two lines of text and a badge read
 * at any width, wrap rather than clip, and put the acknowledgement state where
 * it is actually seen. No horizontal scroll at any size.
 */
export function HoldingsCard({ employeeId }: { employeeId: string }) {
  const { accessToken, status: sessionStatus } = useSession()

  const assetsQuery = useQuery({
    queryKey: ["assets", "employee-holdings", employeeId],
    queryFn: () => listAssets(accessToken!, {}),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  // Loading, empty and broken stay three separate screens: collapsing any two
  // of them is how a dead endpoint starts looking like an employee who holds
  // nothing, which is exactly the wrong answer during an exit conversation.
  if (assetsQuery.isPending) {
    return (
      <div className="flex flex-col rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
        <div className="mb-4 text-[15px] font-bold">Company assets</div>
        <div className="space-y-2.5">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>
    )
  }

  if (assetsQuery.isError) {
    return (
      <div className="flex flex-col rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
        <div className="mb-4 text-[15px] font-bold">Company assets</div>
        <p className="text-[13px] text-[#B03A3A]">
          Could not load company assets.{" "}
          <Button
            variant="link"
            className="h-auto p-0 font-semibold underline"
            onClick={() => assetsQuery.refetch()}
          >
            Retry
          </Button>
        </p>
      </div>
    )
  }

  const holdings = (assetsQuery.data ?? []).filter(
    (asset) => asset.heldBy?.employeeId === employeeId
  )
  const unacknowledged = holdings.filter((a) => a.heldBy!.acknowledgedAt === null).length

  return (
    <div className="flex flex-col rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-bold">Company assets</div>
        {holdings.length > 0 ? (
          <span className="text-[12px] text-[#5F6B7C]">
            {holdings.length} held
            {/* Surfaced on the card, not only per row: during an exit the
                question is "is anything outstanding", and counting badges by
                eye is not an answer. */}
            {unacknowledged > 0 ? ` · ${unacknowledged} unacknowledged` : ""}
          </span>
        ) : null}
      </div>

      {holdings.length === 0 ? (
        <p className="text-[13px] text-[#A5AFBE]">Not holding any company assets.</p>
      ) : (
        <ul className="divide-y divide-[#EFF2F6]">
          {holdings.map((asset) => (
            <li key={asset.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                {/* Wraps rather than truncates. "MacBook Pro 1…" does not
                    identify a machine, and identifying it is the whole job. */}
                <div className="text-[13.5px] leading-snug font-semibold break-words">
                  {asset.name}
                </div>
                <div className="mt-0.5 text-[12px] text-[#5F6B7C]">
                  {/* Tag and category on one line: neither is worth a row of
                      its own at this width, and together they read as one
                      description of the thing. */}
                  <span className="font-mono">{asset.assetTag}</span>
                  <span aria-hidden> · </span>
                  {asset.category.name}
                </div>
                <div className="mt-0.5 text-[12px] text-[#7A8698]">
                  Held since {formatAssetDate(asset.heldBy!.assignedAt)}
                </div>
              </div>

              {asset.heldBy!.acknowledgedAt === null ? (
                // The signal that matters, and the one the old table hid off
                // the right edge: nobody has confirmed they actually received
                // this.
                <Tag label="Unacknowledged" tone="yellow" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
