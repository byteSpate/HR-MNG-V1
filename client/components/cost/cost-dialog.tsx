"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { createCost, getCost, updateCost } from "@/lib/api/costs"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { Currency, CostBill, CostCategory } from "@/lib/api/types"
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
import { formatCostDate, monthName, STATUS_LABEL } from "@/components/cost/cost-shared"
import { ReceiptGallery } from "@/components/cost/receipt-gallery"
import { dialogWidthClass } from "@/components/ds/dialog-sizes"
import { cx } from "@/components/ds/classes"

export interface CostPrefill {
  categoryId: string
  label: string
  payee: string
  commitmentId?: string
  amount?: string | null
  currency?: Currency
  dueDate?: string
}

/**
 * The actual form. Only ever mounted once its starting data is settled —
 * `bill` for edit mode (after `getCost` resolves) or immediately for create
 * mode — so every field's `useState` can seed straight from `bill`/`prefill`
 * with no effect syncing it in afterward. `CostDialog` below is keyed per
 * `costId` by the caller, so a different bill is always a fresh mount too.
 */
function BillForm({
  bill,
  period,
  categories,
  prefill,
  canManage,
  accessToken,
  pending,
  onSubmit,
  onCancel,
  onPay,
  onReceiptsChanged,
}: {
  bill: CostBill | null
  period: { year: number; month: number }
  categories: CostCategory[]
  prefill?: CostPrefill
  canManage: boolean
  accessToken: string
  pending: boolean
  onSubmit: (input: {
    categoryId: string
    label: string
    payee: string
    amount: string
    currency: Currency
    dueDate: string
    notes: string
  }) => void
  onCancel: () => void
  onPay: (id: string) => void
  onReceiptsChanged: () => void
}) {
  const isEdit = !!bill

  const [categoryId, setCategoryId] = useState(bill?.categoryId ?? prefill?.categoryId ?? "")
  const [label, setLabel] = useState(bill?.label ?? prefill?.label ?? "")
  const [payee, setPayee] = useState(bill?.payee ?? prefill?.payee ?? "")
  const [amount, setAmount] = useState(bill?.amount ?? prefill?.amount ?? "")
  const [currency, setCurrency] = useState<Currency>(bill?.currency ?? prefill?.currency ?? "BDT")
  const [dueDate, setDueDate] = useState(
    bill?.dueDate ? bill.dueDate.slice(0, 10) : (prefill?.dueDate ?? "")
  )
  const [notes, setNotes] = useState(bill?.notes ?? "")

  const canSubmit =
    !!categoryId && label.trim().length > 0 && payee.trim().length > 0 && amount.trim().length > 0

  return (
    <>
      <div className="space-y-4">
        <p className="text-caption text-muted-foreground">
          {monthName(period.month)} {period.year}
          {bill ? (
            <>
              {" · "}
              <span className={bill.status === "PAID" ? "font-medium" : "font-semibold text-amber-700"}>
                {STATUS_LABEL[bill.status]}
              </span>
              {bill.isOverdue ? <span className="font-semibold text-destructive"> · Overdue</span> : null}
            </>
          ) : null}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1.5 text-xs font-bold">Category</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? "")} disabled={!canManage}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) => categories.find((c) => c.id === v)?.name ?? "Select a category"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="cost-payee" className="mb-1.5 text-xs font-bold">
              Payee
            </Label>
            <Input id="cost-payee" value={payee} disabled={!canManage} onChange={(e) => setPayee(e.target.value)} />
          </div>
        </div>

        <div>
          <Label htmlFor="cost-label" className="mb-1.5 text-xs font-bold">
            Label
          </Label>
          <Input id="cost-label" value={label} disabled={!canManage} onChange={(e) => setLabel(e.target.value)} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="cost-amount" className="mb-1.5 text-xs font-bold">
              Amount
            </Label>
            <Input
              id="cost-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              disabled={!canManage}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cost-currency" className="mb-1.5 text-xs font-bold">
              Currency
            </Label>
            <Select
              value={currency}
              disabled={!canManage}
              onValueChange={(v) => setCurrency(v as Currency)}
            >
              <SelectTrigger id="cost-currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BDT">BDT</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="cost-due" className="mb-1.5 text-xs font-bold">
              Due date <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="cost-due"
              type="date"
              value={dueDate}
              disabled={!canManage}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="cost-notes" className="mb-1.5 text-xs font-bold">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="cost-notes"
            value={notes}
            maxLength={2000}
            disabled={!canManage}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {bill?.status === "PAID" ? (
          <div className="rounded-md border px-3 py-2 text-caption text-muted-foreground">
            Paid {formatCostDate(bill.paidAt)}
            {bill.paymentRef ? ` · Ref: ${bill.paymentRef}` : ""}
          </div>
        ) : bill && canManage ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onPay(bill.id)}>
            Mark as paid
          </Button>
        ) : null}

        {bill ? (
          <div>
            <Label className="mb-1.5 text-xs font-bold">Receipts</Label>
            <ReceiptGallery
              costId={bill.id}
              attachments={bill.attachments ?? []}
              accessToken={accessToken}
              canManage={canManage}
              onChanged={onReceiptsChanged}
            />
          </div>
        ) : null}

        {bill ? (
          <p className="text-caption text-muted-foreground">
            Recorded against {monthName(bill.periodMonth)} {bill.periodYear}. The period and the
            commitment it is linked to cannot change here.
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          {canManage ? "Cancel" : "Close"}
        </Button>
        {canManage ? (
          <Button
            disabled={!canSubmit || pending}
            onClick={() =>
              onSubmit({
                categoryId,
                label: label.trim(),
                payee: payee.trim(),
                amount,
                currency,
                dueDate,
                notes: notes.trim(),
              })
            }
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Record bill"}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  )
}

/**
 * Create or edit a bill for the month the page has selected. The period and
 * the commitment a bill is linked to are fixed once created — this dialog
 * never offers to change either, matching `updateCostSchema` on the server,
 * which does not accept them.
 *
 * Editing fetches the full bill (`getCost`) rather than trusting the row the
 * table already has, because the table's `listCosts` read does not include
 * attachments — the receipt gallery needs them fresh.
 */
export function CostDialog({
  open,
  onOpenChange,
  costId,
  period,
  categories,
  prefill,
  canManage,
  onSuccess,
  onPay,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null in create mode. */
  costId: string | null
  period: { year: number; month: number }
  categories: CostCategory[]
  prefill?: CostPrefill
  /** HR reaches this dialog read-only — no field edits, no pay, no receipts. */
  canManage: boolean
  onSuccess: () => void
  /** Opens the pay dialog for this bill — the parent owns that dialog's state. */
  onPay: (id: string) => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const isEdit = !!costId
  const [formError, setFormError] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: ["costs", "detail", costId],
    queryFn: () => getCost(accessToken!, costId!),
    enabled: open && isEdit,
  })
  const bill = detailQuery.data ?? null

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["costs"] })
    queryClient.invalidateQueries({ queryKey: ["cost-summary", period.year, period.month] })
  }

  const createMutation = useMutation({
    mutationFn: (input: {
      categoryId: string
      label: string
      payee: string
      amount: string
      currency: Currency
      dueDate: string
      notes: string
    }) =>
      createCost(accessToken!, {
        categoryId: input.categoryId,
        commitmentId: prefill?.commitmentId,
        label: input.label,
        payee: input.payee,
        periodMonth: period.month,
        periodYear: period.year,
        amount: Number(input.amount),
        currency: input.currency,
        dueDate: input.dueDate || undefined,
        notes: input.notes || undefined,
      }),
    onSuccess: () => {
      onOpenChange(false)
      invalidate()
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const updateMutation = useMutation({
    mutationFn: (input: {
      categoryId: string
      label: string
      payee: string
      amount: string
      currency: Currency
      dueDate: string
      notes: string
    }) =>
      updateCost(accessToken!, costId!, {
        categoryId: input.categoryId,
        label: input.label,
        payee: input.payee,
        amount: Number(input.amount),
        currency: input.currency,
        dueDate: input.dueDate || null,
        notes: input.notes || undefined,
      }),
    onSuccess: () => {
      onOpenChange(false)
      invalidate()
      onSuccess()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const pending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cx(dialogWidthClass("md"), "max-h-[85vh] overflow-y-auto")}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit bill" : "Record a bill"}</DialogTitle>
        </DialogHeader>

        {isEdit && detailQuery.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : isEdit && detailQuery.isError ? (
          <p className="text-body-sm font-semibold text-destructive">Failed to load this bill.</p>
        ) : (
          <BillForm
            bill={bill}
            period={period}
            categories={categories}
            prefill={prefill}
            canManage={canManage}
            accessToken={accessToken!}
            pending={pending}
            onSubmit={(input) => {
              setFormError(null)
              if (isEdit) updateMutation.mutate(input)
              else createMutation.mutate(input)
            }}
            onCancel={() => onOpenChange(false)}
            onPay={onPay}
            onReceiptsChanged={() => {
              detailQuery.refetch()
              invalidate()
            }}
          />
        )}

        {formError ? (
          <p className="text-body-sm font-semibold text-destructive">{formError}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
