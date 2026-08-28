"use client"

import { useMemo, useState } from "react"

import { ROUTE_CATEGORY_CODES } from "@/lib/api/types"
import type { Currency, ExpenseCategory, ExpenseClaim, ExpenseClaimInput } from "@/lib/api/types"
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
import { Textarea } from "@/components/ui/textarea"

const today = () => new Date().toISOString().slice(0, 10)

export function ExpenseDialog({
  open,
  onOpenChange,
  pending,
  error,
  onSubmit,
  categories,
  existing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pending: boolean
  error: string | null
  /** The claim, and the file to attach to it once it exists. */
  onSubmit: (input: ExpenseClaimInput, receipt: File | null) => void
  categories: ExpenseCategory[]
  /**
   * The claim being amended, or absent to file a new one.
   *
   * One dialog for both, because the fields and the rules are identical —
   * two would be two places for the travel-route logic to drift apart. Only
   * the wording and the receipt field differ, and both key off this.
   */
  existing?: ExpenseClaim | null
}) {
  const isEdit = !!existing
  const [amount, setAmount] = useState(existing ? String(Number(existing.amount)) : "")
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? "BDT")
  // Without `items`, Base UI's Select shows the category's uuid on the
  // closed trigger instead of its name.
  const categoryItems = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories]
  )

  const [name, setName] = useState(existing?.name ?? "")
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? categories[0]?.id ?? "")
  const [expenseDate, setExpenseDate] = useState(existing?.expenseDate.slice(0, 10) ?? today())
  const [description, setDescription] = useState(existing?.description ?? "")
  const [travelFrom, setTravelFrom] = useState(existing?.travelFrom ?? "")
  const [travelTo, setTravelTo] = useState(existing?.travelTo ?? "")
  const [receipt, setReceipt] = useState<File | null>(null)

  /**
   * A journey has a route; a stationery bill does not. Driven by the selected
   * category's code, which is exactly what the server checks — a client that
   * offered these on every category would be collecting text it knows will be
   * dropped on save.
   */
  const selected = categories.find((c) => c.id === categoryId) ?? null
  const hasRoute = !!selected && ROUTE_CATEGORY_CODES.includes(selected.code.toUpperCase())

  const canSubmit = !!name.trim() && Number(amount) > 0 && !!expenseDate && !!categoryId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit this claim" : "Claim an expense"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* First field, and the one that identifies the claim. Category is
              below it because a category groups rows; it does not tell two of
              them apart, and three "Other" claims in a month are three
              identical lines without this. */}
          <div>
            <Label htmlFor="exp-name" className="mb-1.5 text-xs font-bold">
              Expense name
            </Label>
            <Input
              id="exp-name"
              value={name}
              placeholder="Water jar"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="exp-amount" className="mb-1.5 text-xs font-bold">
                Amount
              </Label>
              <Input
                id="exp-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="exp-currency" className="mb-1.5 text-xs font-bold">
                Currency
              </Label>
              {/* The main real USD case: someone travels and pays in dollars
                  while drawing a BDT salary. */}
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                <SelectTrigger id="exp-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BDT">BDT</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="exp-category" className="mb-1.5 text-xs font-bold">
                Category
              </Label>
               <Select
                items={categoryItems}
                value={categoryId}
                onValueChange={(value) => value && setCategoryId(value)}
              >
                <SelectTrigger id="exp-category" className="w-full">
                  <SelectValue />
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
              <Label htmlFor="exp-date" className="mb-1.5 text-xs font-bold">
                Spend date
              </Label>
              <Input
                id="exp-date"
                type="date"
                max={today()}
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </div>
          </div>

          <div className="text-[11.5px] text-[#7A8698]">
            The exchange rate is frozen from the spend date, not from when the claim is approved.
          </div>

          <div>
            <Label htmlFor="exp-description" className="mb-1.5 text-xs font-bold">
              Description
            </Label>
            <Textarea
              id="exp-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {hasRoute ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="exp-from" className="mb-1.5 text-xs font-bold">
                  From
                </Label>
                <Input
                  id="exp-from"
                  value={travelFrom}
                  onChange={(e) => setTravelFrom(e.target.value)}
                  placeholder="Gulshan 1"
                />
              </div>
              <div>
                <Label htmlFor="exp-to" className="mb-1.5 text-xs font-bold">
                  To
                </Label>
                <Input
                  id="exp-to"
                  value={travelTo}
                  onChange={(e) => setTravelTo(e.target.value)}
                  placeholder="Motijheel"
                />
              </div>
            </div>
          ) : null}

          {/* Not offered while editing. Attaching runs through its own
              endpoint against a claim that already exists, so bolting it onto
              this form would mean two different save paths behind one button.
              Receipts are managed from the claim itself. */}
          <div className={isEdit ? "hidden" : undefined}>
            <Label htmlFor="exp-receipt" className="mb-1.5 text-xs font-bold">
              Receipt
            </Label>
            <Input
              id="exp-receipt"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              className="h-auto py-1.5 text-[12.5px] file:mr-3 file:rounded file:border-0 file:bg-[#F1F4F8] file:px-2.5 file:py-1 file:text-[12px] file:font-semibold"
              onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1.5 text-[11.5px] text-[#7A8698]">
              {/* Said plainly, because the claim is created first and the file
                  attached to it — a failure at that second step needs to be
                  recognisable as "the claim is fine, the file is not". */}
              PDF or image, up to 15MB. The claim is saved first, then the file
              attached to it.
            </p>
          </div>

          {error ? <div className="text-[12.5px] text-[#B03A3A]">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || pending}
            onClick={() =>
              onSubmit(
                {
                  name: name.trim(),
                  amount: Number(amount),
                  currency,
                  categoryId,
                  expenseDate,
                  description: description.trim() || undefined,
                  // Sent only when the category has a route. The server drops
                  // them otherwise, but not sending them keeps the request
                  // honest about what was actually asked for.
                  travelFrom: hasRoute ? travelFrom.trim() || undefined : undefined,
                  travelTo: hasRoute ? travelTo.trim() || undefined : undefined,
                },
                receipt
              )
            }
          >
            {isEdit ? "Save changes" : "Submit claim"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
