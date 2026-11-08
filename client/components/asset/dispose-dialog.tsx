"use client"

import { useState } from "react"

import { formatMoney } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/**
 * Finance disposing of an asset. Proceeds default to zero; the gain or loss
 * is whatever the ledger makes of it. Refused server-side on an asset with an
 * open assignment — a laptop somebody is still holding is a data error.
 */
export function DisposeDialog({
  open,
  onOpenChange,
  asset,
  pending,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  asset: { assetTag: string; name: string; purchaseCost?: string; currency: "BDT" | "USD" } | null
  pending: boolean
  error: string | null
  onConfirm: (input: { proceeds?: string; note?: string }) => void
}) {
  const [proceeds, setProceeds] = useState("")
  const [note, setNote] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispose {asset?.assetTag ?? "this asset"}?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-caption leading-relaxed text-ink-muted">
            Disposing of {asset?.name ?? "this asset"} removes its cost and the depreciation charged to
            date from the balance sheet. The gain or loss on disposal is whatever the ledger makes of
            the difference.
            {asset?.purchaseCost ? (
              <>
                {" "}It was recorded at {formatMoney(asset.purchaseCost, asset.currency ?? "BDT")}.
              </>
            ) : null}
          </p>

          <div>
            <Label htmlFor="dispose-proceeds" className="mb-1.5 text-xs font-bold">
              Proceeds received (optional)
            </Label>
            <Input
              id="dispose-proceeds"
              inputMode="decimal"
              value={proceeds}
              onChange={(e) => setProceeds(e.target.value)}
              placeholder="0.00"
            />
            <p className="mt-1 text-caption text-ink-muted">
              Leave empty if nothing was received for it.
            </p>
          </div>

          <div>
            <Label htmlFor="dispose-note" className="mb-1.5 text-xs font-bold">
              Note (optional)
            </Label>
            <Textarea
              id="dispose-note"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Sold at auction, traded in, broken beyond repair…"
            />
          </div>

          {error ? <p className="text-body-sm font-semibold text-danger">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                onConfirm({
                  proceeds: proceeds.trim() ? proceeds.trim() : undefined,
                  note: note.trim() ? note.trim() : undefined,
                })
              }
              className="bg-ink text-white hover:bg-ink-strong"
            >
              {pending ? "Disposing…" : "Dispose asset"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
