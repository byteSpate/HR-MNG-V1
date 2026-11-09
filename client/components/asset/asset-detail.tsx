"use client"

import { useQuery } from "@tanstack/react-query"

import { getAsset } from "@/lib/api/assets"
import { useSession } from "@/lib/auth/session-context"
import type { AssetDetail as AssetDetailPayload } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { AttachmentGallery, AttachmentUploader } from "@/components/asset/attachment-gallery"
import { CONDITION_LABEL, formatAssetDate, STATUS_LABEL, STATUS_TONE } from "@/components/asset/asset-shared"

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-caption font-bold text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 truncate">{value}</div>
    </div>
  )
}

type TimelineEntry =
  | { kind: "assignment"; at: string; assignment: AssetDetailPayload["assignments"][number] }
  | { kind: "repair"; at: string; repair: AssetDetailPayload["repairs"][number] }

/**
 * The custody register's detail sheet. Its spine is the **history** —
 * assignments and repairs interleaved on one timeline, newest first, with
 * condition photographs inline. That timeline is what a dispute is settled
 * with, so it is the primary content and not a tab nobody opens.
 *
 * Every action shown here is a callback into the parent: this component only
 * reads. The parent owns the assign/return/repair/lifecycle dialogs and their
 * mutations, so there is exactly one place that can invalidate the queries a
 * write affects.
 */
export function AssetDetail({
  assetId,
  open,
  onOpenChange,
  onAssign,
  onReturn,
  onSendRepair,
  onRetire,
  onMarkLost,
  onAcknowledge,
  acknowledgePending = false,
}: {
  assetId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAssign?: (assetId: string) => void
  onReturn?: (assetId: string) => void
  onSendRepair?: (assetId: string) => void
  onRetire?: (assetId: string) => void
  onMarkLost?: (assetId: string) => void
  onAcknowledge?: (assignmentId: string) => void
  acknowledgePending?: boolean
}) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken

  const assetQuery = useQuery({
    queryKey: ["asset", assetId],
    queryFn: () => getAsset(accessToken!, assetId!),
    enabled: isAuthed && open && !!assetId,
  })

  const asset = assetQuery.data
  // The server omits the field rather than nulling it, so this membership
  // test is the honest way to ask "am I entitled to see cost" — never a role
  // check re-derived on the client.
  const hasCosts = !!asset && "purchaseCost" in asset
  const heldBy = asset?.heldBy ?? null

  const timeline: TimelineEntry[] = asset
    ? [
        ...asset.assignments.map((a) => ({ kind: "assignment" as const, at: a.assignedAt, assignment: a })),
        ...asset.repairs.map((r) => ({ kind: "repair" as const, at: r.sentAt, repair: r })),
      ].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
    : []

  const canAssign = asset?.status === "AVAILABLE"
  const canReturn = !!heldBy
  const canSendRepair = !!asset && asset.status !== "IN_REPAIR" && asset.status !== "RETIRED" && asset.status !== "LOST"
  const canRetire = !!asset && asset.status !== "RETIRED"
  const canMarkLost = !!asset && asset.status !== "RETIRED" && asset.status !== "LOST"

  const isHolder = !!heldBy && !!user?.employeeCode && heldBy.employeeCode === user.employeeCode
  const canAcknowledge = isHolder && heldBy !== null && heldBy.acknowledgedAt === null

  const assetAttachments = asset ? asset.attachments.filter((a) => a.assetId === asset.id) : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {assetQuery.isPending ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : assetQuery.isError ? (
          <div className="p-4 text-sm text-destructive">
            Failed to load this asset.{" "}
            <Button variant="link" className="h-auto p-0 font-semibold underline" onClick={() => assetQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : asset ? (
          <>
            <SheetHeader>
              <SheetTitle>
                {asset.assetTag} · {asset.name}
              </SheetTitle>
              <SheetDescription>{asset.category.name}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 px-4 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={STATUS_TONE[asset.status]}>{STATUS_LABEL[asset.status]}</Badge>
                {heldBy ? (
                  <span className="text-xs text-muted-foreground">
                    Held by {heldBy.fullName} ({heldBy.employeeCode})
                    {heldBy.acknowledgedAt === null ? " · unacknowledged" : ""}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                <Field label="Serial number" value={asset.serialNumber ?? "Not recorded"} />
                <Field label="Model" value={asset.model ?? "Not recorded"} />
                <Field label="Location" value={asset.location ?? "Not recorded"} />
                <Field label="Department" value={asset.department?.name ?? "Unassigned"} />
                <Field label="Warranty expiry" value={formatAssetDate(asset.warrantyExpiry)} />
                {hasCosts ? (
                  <>
                    <Field
                      label="Purchase cost"
                      value={asset.purchaseCost ? formatMoney(asset.purchaseCost, asset.currency) : "Not recorded"}
                    />
                    <Field label="Vendor" value={asset.vendor ?? "Not recorded"} />
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 border-y py-3">
                {onAssign && canAssign ? (
                  <Button type="button" size="sm" onClick={() => onAssign(asset.id)}>
                    Assign
                  </Button>
                ) : null}
                {onReturn && canReturn ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => onReturn(asset.id)}>
                    Return
                  </Button>
                ) : null}
                {onSendRepair && canSendRepair ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => onSendRepair(asset.id)}>
                    Send for repair
                  </Button>
                ) : null}
                {onAcknowledge && canAcknowledge && heldBy ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={acknowledgePending}
                    onClick={() => onAcknowledge(heldBy.assignmentId)}
                  >
                    {acknowledgePending ? "Acknowledging…" : "Acknowledge"}
                  </Button>
                ) : null}
                {onRetire && canRetire ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => onRetire(asset.id)}>
                    Retire
                  </Button>
                ) : null}
                {onMarkLost && canMarkLost ? (
                  <Button type="button" size="sm" variant="destructive" onClick={() => onMarkLost(asset.id)}>
                    Mark lost
                  </Button>
                ) : null}
              </div>

              {/* Rendered even with nothing in it, so long as the viewer can
                  add one. Hiding the section when empty is what made adding
                  the first invoice impossible. */}
              {assetAttachments.length > 0 || onAssign ? (
                <div>
                  <div className="mb-1.5 text-xs font-bold text-muted-foreground uppercase">
                    Photos &amp; documents
                  </div>
                  <AttachmentGallery
                    attachments={assetAttachments}
                    accessToken={accessToken!}
                    emptyLabel="Nothing attached to this asset yet."
                    // onAssign is the existing HR / Super Admin signal on this
                    // sheet, and it matches the server's guard on both the
                    // upload and the delete routes.
                    canDelete={!!onAssign}
                    onChanged={() => assetQuery.refetch()}
                  />
                  {onAssign ? <AttachmentUploader assetId={asset.id} onChanged={() => assetQuery.refetch()} /> : null}
                </div>
              ) : null}

              <div>
                <div className="mb-2 text-xs font-bold text-muted-foreground uppercase">History</div>
                {timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No custody or repair history yet.</p>
                ) : (
                  <ol className="space-y-3">
                    {timeline.map((entry) =>
                      entry.kind === "assignment" ? (
                        <li key={`a-${entry.assignment.id}`} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold">
                              {entry.assignment.employee?.fullName ?? entry.assignment.employeeId}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatAssetDate(entry.assignment.assignedAt)}
                              {entry.assignment.returnedAt
                                ? ` – ${formatAssetDate(entry.assignment.returnedAt)}`
                                : " – present"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {CONDITION_LABEL[entry.assignment.conditionOut]}
                            {" → "}
                            {entry.assignment.conditionIn
                              ? CONDITION_LABEL[entry.assignment.conditionIn]
                              : "not yet returned"}
                          </div>
                          {entry.assignment.acknowledgedAt === null && !entry.assignment.returnedAt ? (
                            <div className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                              Unacknowledged
                            </div>
                          ) : null}
                          {entry.assignment.issueNote ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Issued: {entry.assignment.issueNote}
                            </div>
                          ) : null}
                          {entry.assignment.returnNote ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Returned: {entry.assignment.returnNote}
                            </div>
                          ) : null}
                          <div className="mt-2">
                            <AttachmentGallery
                              attachments={asset.attachments.filter(
                                (att) => att.assignmentId === entry.assignment.id
                              )}
                              accessToken={accessToken!}
                            />
                          </div>
                        </li>
                      ) : (
                        <li key={`r-${entry.repair.id}`} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold">
                              Repair{entry.repair.vendor ? ` · ${entry.repair.vendor}` : ""}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {formatAssetDate(entry.repair.sentAt)}
                              {entry.repair.returnedAt
                                ? ` – ${formatAssetDate(entry.repair.returnedAt)}`
                                : " – open"}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{entry.repair.fault}</div>
                          {entry.repair.isWarranty ? (
                            <div className="mt-1 text-xs text-muted-foreground">Under warranty</div>
                          ) : null}
                          {entry.repair.outcome ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Outcome: {entry.repair.outcome}
                              {entry.repair.conditionAfter
                                ? ` (${CONDITION_LABEL[entry.repair.conditionAfter]})`
                                : ""}
                            </div>
                          ) : null}
                          {hasCosts && entry.repair.cost ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Cost: {formatMoney(entry.repair.cost, entry.repair.currency)}
                            </div>
                          ) : null}
                        </li>
                      )
                    )}
                  </ol>
                )}
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
