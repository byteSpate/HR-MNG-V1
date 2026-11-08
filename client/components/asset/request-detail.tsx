"use client"

import { useQuery } from "@tanstack/react-query"

import { getAssetRequestTimeline } from "@/lib/api/assets"
import { useSession } from "@/lib/auth/session-context"
import type { AssetRequest, AssetRequestTimelineEntry } from "@/lib/api/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  REQUEST_STAGE_LABEL,
  REQUEST_STAGE_TONE,
  isRequestOpen,
} from "@/components/asset/asset-shared"

/**
 * One request, and the story of how it got where it is.
 *
 * The spine is the **history**, for the same reason the asset sheet's is: the
 * question this screen answers is "where has this got to and who moved it",
 * and that is a sequence, not a field. Everything above the history is context
 * for reading it.
 *
 * Read-only by design. Every action lives on the request row in the table, so
 * there is one place that owns the mutations and the query invalidation they
 * need — the same split `AssetDetail` keeps with its parent.
 */

/** The audit vocabulary, in the words a person would use about their own request. */
const ACTION_LABEL: Record<string, string> = {
  SUBMIT: "Requested",
  APPROVE: "Approved",
  REJECT: "Rejected",
  ORDER: "Ordered",
  FULFIL: "Handed over",
  CANCEL: "Cancelled",
}

/** Terminal steps read differently from steps that moved it along. */
const ACTION_TONE: Record<string, string> = {
  REJECT: "bg-red-500",
  CANCEL: "bg-neutral-400",
}

function formatMoment(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-caption font-bold text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 text-body-sm">{value}</div>
    </div>
  )
}

/**
 * The rail. Each entry is a filled dot on a hairline; the step still to come
 * is a hollow ring, so "where it is now" is visible without reading dates.
 *
 * The connector is drawn on the item rather than behind the list so it stops
 * at the last dot instead of running past it into whitespace.
 */
function Timeline({
  entries,
  pendingLabel,
}: {
  entries: AssetRequestTimelineEntry[]
  pendingLabel: string | null
}) {
  return (
    <ol className="relative">
      {entries.map((entry, i) => {
        const last = i === entries.length - 1 && !pendingLabel
        return (
          <li key={`${entry.action}-${entry.at}-${i}`} className="relative flex gap-3 pb-5 last:pb-0">
            {!last ? (
              <span
                aria-hidden
                className="absolute top-4 bottom-0 left-[5px] w-px bg-line"
              />
            ) : null}
            <span
              aria-hidden
              className={`relative mt-1.5 size-[11px] shrink-0 rounded-full ${
                ACTION_TONE[entry.action] ?? "bg-ink"
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-body-sm font-semibold text-ink-body">
                {ACTION_LABEL[entry.action] ?? entry.action}
              </div>
              <div className="mt-0.5 text-caption text-ink-muted tabular-nums">
                {formatMoment(entry.at)}
              </div>
              {entry.note ? (
                <p className="mt-1.5 border-l-2 border-line pl-2.5 text-caption leading-relaxed text-ink-soft">
                  {entry.note}
                </p>
              ) : null}
            </div>
          </li>
        )
      })}

      {/* What the request is waiting on. A hollow ring rather than a filled dot
          because nothing has happened yet — it is the next step, not a step. */}
      {pendingLabel ? (
        <li className="relative flex gap-3">
          <span
            aria-hidden
            className="relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-line-strong bg-white"
          />
          <div className="min-w-0 flex-1">
            <div className="text-body-sm font-semibold text-ink-muted">{pendingLabel}</div>
            <div className="mt-0.5 text-caption text-ink-muted">Not yet</div>
          </div>
        </li>
      ) : null}
    </ol>
  )
}

/** What the request is waiting on, phrased as the thing that has not happened. */
function nextStepFor(request: AssetRequest): string | null {
  if (!isRequestOpen(request.stage)) return null
  switch (request.stage) {
    case "AWAITING_APPROVAL":
      return "Awaiting a decision"
    case "APPROVED":
      return "Awaiting the item"
    case "ORDERED":
      return "Ordered, awaiting delivery"
    case "IN_REPAIR":
      return "Awaiting return from the repairer"
    case "AWAITING_COLLECTION":
      return "Awaiting collection"
    default:
      return null
  }
}

export function RequestDetail({
  request,
  open,
  onOpenChange,
}: {
  request: AssetRequest | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { accessToken } = useSession()

  const timelineQuery = useQuery({
    queryKey: ["asset-request-timeline", request?.id],
    queryFn: () => getAssetRequestTimeline(accessToken!, request!.id),
    enabled: open && !!request && !!accessToken,
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {!request ? null : (
          <>
            <SheetHeader>
              <SheetTitle>{request.employee?.fullName ?? "This request"}</SheetTitle>
              <SheetDescription>
                {[request.employee?.employeeCode, request.category?.name]
                  .filter(Boolean)
                  .join(" · ")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={REQUEST_STAGE_TONE[request.stage]}>
                  {REQUEST_STAGE_LABEL[request.stage]}
                </Badge>
              </div>

              <div>
                <div className="text-caption font-bold text-muted-foreground uppercase">Reason</div>
                <p className="mt-1 text-body-sm leading-relaxed">{request.reason}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Detail label="Requested" value={formatMoment(request.createdAt)} />
                {request.quantity !== null ? (
                  <Detail label="Quantity" value={String(request.quantity)} />
                ) : null}
                {request.expectedBy ? (
                  <Detail label="Expected by" value={formatMoment(request.expectedBy)} />
                ) : null}
              </div>

              <div className="border-t border-line pt-4">
                <div className="mb-3 text-body-sm font-bold">History</div>

                {timelineQuery.isPending ? (
                  <div className="space-y-4">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex gap-3">
                        <Skeleton className="mt-1.5 size-[11px] shrink-0 rounded-full" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-3.5 w-24" />
                          <Skeleton className="h-3 w-36" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : timelineQuery.isError ? (
                  <div className="text-body-sm text-destructive">
                    The history could not be loaded.{" "}
                    <Button
                      variant="link"
                      className="h-auto p-0 font-semibold underline"
                      onClick={() => timelineQuery.refetch()}
                    >
                      Try again
                    </Button>
                  </div>
                ) : (timelineQuery.data ?? []).length === 0 ? (
                  // Not reachable in normal use — submitting writes the first
                  // audit row in the same transaction — so this says what it
                  // means rather than pretending the request does not exist.
                  <p className="text-caption text-ink-muted">
                    No history was recorded for this request.
                  </p>
                ) : (
                  <Timeline
                    entries={timelineQuery.data ?? []}
                    pendingLabel={nextStepFor(request)}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
