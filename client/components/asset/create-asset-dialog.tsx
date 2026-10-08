"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { createAsset, getAsset, listCategories, updateAsset } from "@/lib/api/assets"
import { listDepartments } from "@/lib/api/departments"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { REFERENCE_STALE_MS } from "@/lib/query/default-options"
import type { AssetDetail, Currency } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { formatAssetDate } from "@/components/asset/asset-shared"
import { PanelAlert } from "@/components/dashboard/record-kit"

/** `<input type="date">` wants YYYY-MM-DD; the API sends a full ISO string. */
function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ""
}

/**
 * Who is holding this asset — read-only, above the editable fields.
 *
 * Custody is deliberately not a field on the asset. A handover is its own
 * record: a condition it went out in, optional photographs, an acknowledgement
 * from the person who took it, and later a return with the condition it came
 * back in. Making it a dropdown on this form would throw all of that away and
 * would let someone silently rewrite who was responsible for a laptop last
 * March.
 *
 * The strip exists because saying nothing about custody here read as *the
 * register does not track that*, which is what sends people to type "assign to
 * Reza" into Notes — a sentence nothing can act on, and one that leaves the
 * asset still AVAILABLE for the next person to hand out.
 */
function CustodyStrip({
  asset,
  onHandOver,
  onReturn,
}: {
  asset: AssetDetail
  /** HR / Super Admin only, matching the guards on the assign and return routes. */
  onHandOver?: () => void
  onReturn?: () => void
}) {
  const heldBy = asset.heldBy
  const action = heldBy ? onReturn : onHandOver

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-[#F1F4F8] px-3.5 py-2.5 text-[12.5px] text-[#5F6B7C]">
      <span className="min-w-0 flex-1">
        {heldBy ? (
          <>
            Held by{" "}
            <span className="font-semibold text-[#1C2733]">
              {heldBy.fullName} ({heldBy.employeeCode})
            </span>{" "}
            since {formatAssetDate(heldBy.assignedAt)}
            {heldBy.acknowledgedAt === null ? ", not yet acknowledged" : ""}.
          </>
        ) : (
          <>
            <span className="font-semibold text-[#1C2733]">Not handed to anyone.</span> Recording a
            handover is a separate step — it captures the condition and asks the holder to confirm.
          </>
        )}
      </span>
      {action ? (
        <Button
          type="button"
          variant="link"
          onClick={action}
          className="h-auto shrink-0 p-0 text-[12px] font-bold text-[#1C2733] underline"
        >
          {heldBy ? "Take it back" : "Hand it over"}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * One form, both modes.
 *
 * `updateAssetSchema` is literally `createAssetSchema.partial()`, so the
 * editable field set and the creatable one are the same set. A separate edit
 * dialog would be a second copy of that list to keep in step, and the serial
 * -required rule (`AssetCategory.requiresSerial`) would have to be written
 * twice with it.
 *
 * Mounted only while the dialog is open and — in edit mode — only once the
 * asset has loaded, so every `useState` below seeds from real data through its
 * initializer rather than an effect.
 */
function AssetForm({
  asset,
  prefillCategoryId,
  requestedBy,
  onOpenChange,
  onSuccess,
  onHandOver,
  onReturn,
}: {
  /** null creates; non-null edits. */
  asset: AssetDetail | null
  prefillCategoryId?: string
  requestedBy?: string
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  onHandOver?: (assetId: string) => void
  onReturn?: (assetId: string) => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()

  // Seeded at first render rather than in an effect, so the select is right on
  // the first paint with no flash of an empty field. The parent keys this
  // component on the request id, so opening it for a different row re-seeds.
  const [categoryId, setCategoryId] = useState(asset?.categoryId ?? prefillCategoryId ?? "")
  const [name, setName] = useState(asset?.name ?? "")
  const [serialNumber, setSerialNumber] = useState(asset?.serialNumber ?? "")
  const [model, setModel] = useState(asset?.model ?? "")
  const [purchaseDate, setPurchaseDate] = useState(toDateInput(asset?.purchaseDate))
  const [purchaseCost, setPurchaseCost] = useState(asset?.purchaseCost ?? "")
  const [currency, setCurrency] = useState<Currency>(asset?.currency ?? "BDT")
  const [vendor, setVendor] = useState(asset?.vendor ?? "")
  const [warrantyExpiry, setWarrantyExpiry] = useState(toDateInput(asset?.warrantyExpiry))
  const [departmentId, setDepartmentId] = useState(asset?.departmentId ?? "")
  const [location, setLocation] = useState(asset?.location ?? "")
  const [notes, setNotes] = useState(asset?.notes ?? "")
  const [formError, setFormError] = useState<string | null>(null)

  const categoriesQuery = useQuery({
    queryKey: ["asset-categories"],
    staleTime: REFERENCE_STALE_MS,
    queryFn: () => listCategories(accessToken!),
  })

  const departmentsQuery = useQuery({
    queryKey: ["departments"],
    staleTime: REFERENCE_STALE_MS,
    queryFn: () => listDepartments(accessToken!),
  })

  const selectedCategory = categoriesQuery.data?.find((c) => c.id === categoryId)
  const serialRequired = !!selectedCategory?.requiresSerial

  const saveMutation = useMutation({
    mutationFn: () => {
      const input = {
        categoryId,
        name: name.trim(),
        serialNumber: serialNumber.trim() || undefined,
        model: model.trim() || undefined,
        notes: notes.trim() || undefined,
        purchaseDate: purchaseDate || undefined,
        purchaseCost: purchaseCost ? Number(purchaseCost) : undefined,
        currency,
        vendor: vendor.trim() || undefined,
        warrantyExpiry: warrantyExpiry || undefined,
        departmentId: departmentId || undefined,
        location: location.trim() || undefined,
      }
      return asset ? updateAsset(accessToken!, asset.id, input) : createAsset(accessToken!, input)
    },
    onSuccess: () => {
      onOpenChange(false)
      // Enriched fields (category name, computed status) come from the next
      // `listAssets` read, never from this response.
      queryClient.invalidateQueries({ queryKey: ["assets"] })
      if (asset) queryClient.invalidateQueries({ queryKey: ["asset", asset.id] })
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const canSubmit =
    !!categoryId && name.trim().length > 0 && (!serialRequired || serialNumber.trim().length > 0)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{asset ? "Edit asset" : "Add an asset"}</DialogTitle>
      </DialogHeader>

      {/* Says why the dialog opened, so a prefilled category does not look
          like a stray default. Deliberately does not promise to assign it:
          the handover stays a separate act on the request row. */}
      {!asset && requestedBy ? (
        <PanelAlert>
          Adding this registers it and nothing more. Hand it to {requestedBy} from their
          request afterwards, so the register records who issued it and in what condition.
        </PanelAlert>
      ) : null}

      {/* Edit only. A brand-new asset has no custody yet by definition, and
          offering a handover before the record exists would need the create to
          have already run. */}
      {asset ? (
        <CustodyStrip
          asset={asset}
          // Same rules the detail sheet applies: only an AVAILABLE asset can
          // go out, and only one that is out can come back.
          onHandOver={asset.status === "AVAILABLE" && onHandOver ? () => onHandOver(asset.id) : undefined}
          onReturn={asset.heldBy && onReturn ? () => onReturn(asset.id) : undefined}
        />
      ) : null}

      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 text-xs font-bold">Category</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    categoriesQuery.data?.find((c) => c.id === v)?.name ?? "Select a category"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(categoriesQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="asset-name" className="mb-1.5 text-xs font-bold">
              Name
            </Label>
            <Input id="asset-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="asset-serial" className="mb-1.5 text-xs font-bold">
              Serial number{" "}
              <span className="font-normal text-muted-foreground">
                {serialRequired ? `(required for ${selectedCategory!.name})` : "(optional)"}
              </span>
            </Label>
            <Input
              id="asset-serial"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
            />
          </div>
          <div>
            <Label className="mb-1.5 text-xs font-bold">
              Department <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    departmentsQuery.data?.find((d) => d.id === v)?.name ?? "No department"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(departmentsQuery.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="asset-model" className="mb-1.5 text-xs font-bold">
              Model <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="asset-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="asset-location" className="mb-1.5 text-xs font-bold">
              Location <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="asset-location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="asset-cost" className="mb-1.5 text-xs font-bold">
              Purchase cost <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="asset-cost"
              type="number"
              min="0"
              step="0.01"
              value={purchaseCost}
              onChange={(e) => setPurchaseCost(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="asset-currency" className="mb-1.5 text-xs font-bold">
              Currency
            </Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
              <SelectTrigger id="asset-currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BDT">BDT</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="asset-purchase-date" className="mb-1.5 text-xs font-bold">
              Purchase date <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="asset-purchase-date"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="asset-vendor" className="mb-1.5 text-xs font-bold">
              Vendor <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="asset-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="asset-warranty" className="mb-1.5 text-xs font-bold">
              Warranty expiry <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="asset-warranty"
              type="date"
              value={warrantyExpiry}
              onChange={(e) => setWarrantyExpiry(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="asset-notes" className="mb-1.5 text-xs font-bold">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="asset-notes"
            rows={2}
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {formError ? <p className="text-[13px] font-semibold text-destructive">{formError}</p> : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
          Cancel
        </Button>
        <Button disabled={!canSubmit || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending
            ? asset
              ? "Saving…"
              : "Adding…"
            : asset
              ? "Save changes"
              : "Add asset"}
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * The one path to a register entry the import wizard does not cover — a
 * single asset HR just bought — and the only way to correct one afterwards.
 *
 * Only category and name are required; every acquisition field the server
 * accepts (purchase date/cost/currency, vendor, warranty, department,
 * location, model, notes) is here but optional.
 *
 * The serial number is the one field whose requirement depends on the chosen
 * category (`AssetCategory.requiresSerial`) — asked for up front rather than
 * left for the 400 to explain, matching `asset.import.ts`'s row validator,
 * which enforces the identical rule on import.
 */
export function CreateAssetDialog({
  open,
  assetId,
  prefillCategoryId,
  requestedBy,
  onOpenChange,
  onSuccess,
  onHandOver,
  onReturn,
}: {
  open: boolean
  /** Non-null puts the dialog in edit mode. */
  assetId?: string | null
  /** Seeds the category when opened from an approved request. */
  prefillCategoryId?: string
  /** Whose request opened this, so the dialog can say why it is here. */
  requestedBy?: string
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  /**
   * Handing over and taking back are the parent's dialogs, not this one's —
   * the page owns every asset mutation so there is one place that invalidates
   * the queries a write affects. Absent for viewers who may not do either.
   */
  onHandOver?: (assetId: string) => void
  onReturn?: (assetId: string) => void
}) {
  const { accessToken } = useSession()

  const assetQuery = useQuery({
    queryKey: ["asset", assetId],
    queryFn: () => getAsset(accessToken!, assetId!),
    enabled: open && !!assetId,
  })

  const editing = !!assetId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No max-h/overflow here: DialogContent already carries
          `max-h-[85svh] overflow-y-auto`, and re-declaring it made the whole
          popup — header and footer included — the scroll container, so the
          track spanned the full dialog. Widening to 2xl and laying the form
          two-up fits every field inside 85svh, so the base overflow stays as
          a safety net for short windows without ever appearing. */}
      <DialogContent className="sm:max-w-2xl">
        {!open ? null : editing && !assetQuery.data ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <AssetForm
            asset={assetQuery.data ?? null}
            prefillCategoryId={prefillCategoryId}
            requestedBy={requestedBy}
            onOpenChange={onOpenChange}
            onSuccess={onSuccess}
            onHandOver={onHandOver}
            onReturn={onReturn}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
