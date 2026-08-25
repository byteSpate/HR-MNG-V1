"use client"

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { fulfilAssetRequest, listAssets } from "@/lib/api/assets"
import { useSession } from "@/lib/auth/session-context"
import type { Asset, AssetRequest } from "@/lib/api/types"
import {
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Model and serial, when the register has them.
 *
 * A category is a posting bucket, so "Furniture" can hold a chair and a
 * printer table at once; the person picking here is deciding whether this
 * particular unit is the thing that was asked for, and tag plus name is
 * sometimes not enough to tell. Omitted entirely when both are null rather
 * than shown as a placeholder — an empty detail line reads as a fact.
 */
function detailOf(asset: Asset): string | null {
  const parts = [asset.model, asset.serialNumber].filter((p): p is string => !!p)
  return parts.length ? parts.join(" · ") : null
}

/**
 * The step that turns an approved request into custody.
 *
 * `POST /api/assets/requests/:id/fulfil` and its client function both existed
 * and neither had a caller, so a request could be approved and then went
 * nowhere: the employee saw "Approved" and never received anything, and the
 * only way to actually hand the asset over was to assign it from the register
 * and leave the request sitting in the queue forever.
 *
 * The picker is scoped to assets that are AVAILABLE and in the category that
 * was requested, which is what the server will accept. Offering the whole
 * register here would mostly offer choices that 409.
 */
export function FulfilDialog({
  request,
  onOpenChange,
  onSuccess,
}: {
  request: AssetRequest | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  return (
    <Dialog open={!!request} onOpenChange={(next) => !next && onOpenChange(false)}>
      <DialogContent>
        {request ? (
          <FulfilForm request={request} onOpenChange={onOpenChange} onSuccess={onSuccess} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function FulfilForm({
  request,
  onOpenChange,
  onSuccess,
}: {
  request: AssetRequest
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const { accessToken } = useSession()
  const [assetId, setAssetId] = useState("")
  const [error, setError] = useState<string | null>(null)

  const categoryId = request.category?.id

  const availableQuery = useQuery({
    queryKey: ["assets", { status: "AVAILABLE", categoryId }],
    queryFn: () => listAssets(accessToken!, { status: "AVAILABLE", categoryId }),
    enabled: !!accessToken,
  })

  const fulfilMutation = useMutation({
    mutationFn: () => fulfilAssetRequest(accessToken!, request.id, { assetId }),
    onSuccess: () => {
      onOpenChange(false)
      onSuccess()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const available = availableQuery.data ?? []
  const chosen = available.find((a) => a.id === assetId)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Fulfil this request</DialogTitle>
        <DialogDescription>
          Handing over an asset assigns it to {request.employee?.fullName ?? "the requester"} and
          closes the request. They still have to acknowledge the handover.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-[#5F6B7C]">Requested</dt>
          <dd className="font-semibold">{request.category?.name ?? "No category"}</dd>
          <dt className="text-[#5F6B7C]">Reason</dt>
          <dd>{request.reason}</dd>
        </dl>

        {availableQuery.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : availableQuery.isError ? (
          <PanelAlert>
            The list of available assets could not be loaded. Nothing has been handed over.
          </PanelAlert>
        ) : available.length === 0 ? (
          // Not an error and not an empty dropdown: there is a real answer
          // here, and it is that this cannot be fulfilled until stock exists.
          <PanelAlert>
            No {request.category?.name ?? "matching"} asset is available right now. Add one to the
            register or return one from a previous holder, then fulfil this request.
          </PanelAlert>
        ) : (
          <Field
            label="Asset to hand over"
            hint="Only assets that are available and in the requested category are listed. A category holds more than one kind of thing, so check the unit is what was asked for."
          >
            <Select value={assetId} onValueChange={(v) => setAssetId((v as string) ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {() =>
                    chosen ? `${chosen.assetTag} · ${chosen.name}` : "Choose an available asset"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {available.map((a) => {
                  const detail = detailOf(a)
                  return (
                    <SelectItem key={a.id} value={a.id}>
                      <span>
                        {a.assetTag} · {a.name}
                      </span>
                      {detail ? <span className={TONE.muted}>{detail}</span> : null}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </Field>
        )}

        {error ? <FormError>{error}</FormError> : null}
      </div>

      <DialogFooter>
        <DialogActions
          pending={fulfilMutation.isPending}
          submitLabel="Hand over"
          disabled={!assetId || available.length === 0}
          onCancel={() => onOpenChange(false)}
          onSubmit={() => fulfilMutation.mutate()}
        />
      </DialogFooter>
    </>
  )
}
