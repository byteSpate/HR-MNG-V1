"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiCheckLine, RiLinksLine } from "@remixicon/react"

import { getSupplierAgeing, listSupplierBills } from "@/lib/api/supplierBill"
import {
  approveSupplierPayment,
  createSupplierPayment,
  listSupplierPayments,
  matchAdvance,
  type SupplierPaymentInput,
} from "@/lib/api/supplierPayment"
import { listSuppliers } from "@/lib/api/supplier"
import { useSession } from "@/lib/auth/session-context"
import type { Supplier, SupplierAgeingRow, SupplierBill, SupplierPayment } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import {
  CheckboxField,
  ConfirmDialog,
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  PanelTable,
  RowActions,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** The taka still sitting in 1232 as an advance on this payment. */
function advanceLeft(p: SupplierPayment): number {
  if (p.currency === "USD" && p.sourceAmount && p.fxRateToBdt) {
    const usd = Number(p.sourceAmount) - p.allocations.reduce((s, a) => s + Number(a.amountUsd ?? 0), 0)
    return Math.round(usd * Number(p.fxRateToBdt) * 100) / 100
  }
  return Math.round((Number(p.amount) - p.allocations.reduce((s, a) => s + Number(a.amount), 0)) * 100) / 100
}

export function SupplierPaymentPage() {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [approving, setApproving] = useState<SupplierPayment | null>(null)
  const [matching, setMatching] = useState<SupplierPayment | null>(null)
  const [error, setError] = useState<string | null>(null)

  const payments = useQuery({
    queryKey: ["supplier-payments"],
    queryFn: () => listSupplierPayments(accessToken!),
    enabled: Boolean(accessToken),
  })
  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => listSuppliers(accessToken!),
    enabled: Boolean(accessToken),
  })
  const bills = useQuery({
    queryKey: ["supplier-bills"],
    queryFn: () => listSupplierBills(accessToken!),
    enabled: Boolean(accessToken),
  })
  const ageing = useQuery({
    queryKey: ["supplier-ageing"],
    queryFn: () => getSupplierAgeing(accessToken!),
    enabled: Boolean(accessToken),
  })

  const supplierName = useMemo(() => {
    const byId = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]))
    return (id: string) => byId.get(id) ?? "Unknown supplier"
  }, [suppliers.data])

  const billNumber = useMemo(() => {
    const byId = new Map((bills.data ?? []).map((b) => [b.id, b.billNumber]))
    return (id: string) => byId.get(id) ?? "a bill"
  }, [bills.data])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-payments"] })
    queryClient.invalidateQueries({ queryKey: ["supplier-ageing"] })
  }

  const create = useMutation({
    mutationFn: (input: SupplierPaymentInput) => createSupplierPayment(accessToken!, input),
    onSuccess: () => {
      setCreating(false)
      setError(null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const approve = useMutation({
    mutationFn: (id: string) => approveSupplierPayment(accessToken!, id),
    onSuccess: () => {
      setApproving(null)
      refresh()
    },
    onError: (err) => {
      setApproving(null)
      setError(toMessage(err))
    },
  })

  const match = useMutation({
    mutationFn: ({ id, billId, openingBalanceId, amount }: { id: string; billId?: string; openingBalanceId?: string; amount: string }) =>
      matchAdvance(accessToken!, id, { billId, openingBalanceId, amount }),
    onSuccess: () => {
      setMatching(null)
      setError(null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const add = () => {
    setError(null)
    setCreating(true)
  }

  const rows: TableCell[][] = (payments.data ?? []).map((p) => {
    const advance = advanceLeft(p)
    const actions = [
      ...(p.status === "DRAFT" && isSuperAdmin && p.createdBy !== user?.id
        ? [{
            kind: "custom" as const,
            label: "Approve",
            icon: <RiCheckLine className="size-3.5" aria-hidden />,
            onClick: () => { setError(null); setApproving(p) },
          }]
        : []),
      ...(p.status === "APPROVED" && p.currency === "BDT" && advance > 0
        ? [{
            kind: "custom" as const,
            label: "Match advance",
            icon: <RiLinksLine className="size-3.5" aria-hidden />,
            onClick: () => { setError(null); setMatching(p) },
          }]
        : []),
    ]
    const settles = p.allocations.map((a) => billNumber(a.billId))
    return [
      { text: supplierName(p.supplierId), sub: p.reference ?? undefined, weight: 600 },
      { text: formatDate(p.date) },
      {
        text: formatMoney(p.amount, "BDT"),
        sub: p.currency === "USD" && p.sourceAmount ? `${formatMoney(p.sourceAmount, "USD")} at ${Number(p.fxRateToBdt).toFixed(2)}` : undefined,
      },
      {
        text: settles.length > 0 ? settles.join(", ") : "No bill yet",
        sub: advance > 0 ? `${formatMoney(advance.toFixed(2), "BDT")} held as an advance` : undefined,
      },
      { node: <Badge variant={p.status === "APPROVED" ? "default" : "secondary"}>{p.status === "APPROVED" ? "Approved" : "Draft"}</Badge> },
      { node: actions.length > 0 ? <RowActions actions={actions} /> : null },
    ]
  })

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Supplier payments"
        sub="What we have paid suppliers, and what is still held as an advance. Approval posts the payment."
        cta="New payment"
        onCta={add}
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      <PanelTable
        cols="1.4fr 0.8fr 1.1fr 1.4fr 0.7fr 1.1fr"
        headers={["Supplier", "Date", "Paid", "Settles", "Status", ""]}
        rows={rows}
        isLoading={payments.isPending}
        isError={payments.isError}
        onRetry={() => payments.refetch()}
        emptyTitle="No supplier payments yet"
        emptyBody="Record a payment against one or more approved bills, or with no bill at all when paying in advance."
        emptyAction="New payment"
        onEmptyAction={add}
      />

      {creating ? (
        <PaymentDialog
          suppliers={(suppliers.data ?? []).filter((s) => s.isActive)}
          bills={bills.data ?? []}
          openBills={ageing.data ?? []}
          pending={create.isPending}
          error={error}
          onClose={() => setCreating(false)}
          onSave={(input) => create.mutate(input)}
        />
      ) : null}

      {matching ? (
        <MatchAdvanceDialog
          payment={matching}
          available={advanceLeft(matching)}
          openBills={(ageing.data ?? []).filter((r) => r.supplierId === matching.supplierId)}
          pending={match.isPending}
          error={error}
          onClose={() => setMatching(null)}
          onSave={(target, amount) =>
            match.mutate(
              target.billId
                ? { id: matching.id, billId: target.billId, amount }
                : { id: matching.id, openingBalanceId: target.openingBalanceId!, amount }
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={approving !== null}
        title="Approve this payment?"
        body={
          approving
            ? `This posts ${formatMoney(approving.amount, "BDT")} leaving the bank for ${supplierName(approving.supplierId)}. It cannot be edited after approval.`
            : ""
        }
        confirmLabel="Approve and post"
        pending={approve.isPending}
        onCancel={() => setApproving(null)}
        onConfirm={() => approving && approve.mutate(approving.id)}
      />
    </div>
  )
}

function PaymentDialog({
  suppliers,
  bills,
  openBills,
  pending,
  error,
  onClose,
  onSave,
}: {
  suppliers: Supplier[]
  bills: SupplierBill[]
  openBills: SupplierAgeingRow[]
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: SupplierPaymentInput) => void
}) {
  const [supplierId, setSupplierId] = useState("")
  const [date, setDate] = useState(today())
  const [currency, setCurrency] = useState<"BDT" | "USD">("BDT")
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [picked, setPicked] = useState<Record<string, string>>({})

  const billById = useMemo(() => new Map(bills.map((b) => [b.id, b])), [bills])

  /** A row's allocation key: the bill id, or the opening-balance id when it
   *  has no bill. Exactly one is set on every ageing row. */
  const keyOf = (row: SupplierAgeingRow): string => row.billId ?? row.openingBalanceId!

  // Open bills (and the opening balance) for this supplier. A USD payment
  // cannot settle the opening balance — it is always in taka — and can only
  // settle bills that were themselves entered in USD.
  const candidates = openBills
    .filter((r) => r.supplierId === supplierId)
    .filter((r) => (currency === "BDT" ? true : r.billId !== null && billById.get(r.billId)?.currency === "USD"))

  /** What is left on the row, in the payment's currency. */
  const leftOn = (row: SupplierAgeingRow): number => {
    const bill = row.billId ? billById.get(row.billId) : undefined
    if (currency === "USD" && bill?.fxRateToBdt) return Math.floor((Number(row.outstanding) / Number(bill.fxRateToBdt)) * 100) / 100
    return Number(row.outstanding)
  }

  const allocated = Object.values(picked).reduce((s, v) => s + (Number(v) || 0), 0)
  const advance = (Number(amount) || 0) - allocated

  const toggle = (row: SupplierAgeingRow, on: boolean) =>
    setPicked((all) => {
      const next = { ...all }
      const key = keyOf(row)
      if (on) {
        const remaining = Math.max(0, (Number(amount) || 0) - allocated)
        next[key] = String(Math.min(leftOn(row), remaining || leftOn(row)))
      } else {
        delete next[key]
      }
      return next
    })

  const changeScope = (apply: () => void) => {
    apply()
    setPicked({})
  }

  const canSubmit =
    Boolean(supplierId && date && Number(amount) > 0) &&
    advance >= -0.001 &&
    Object.values(picked).every((v) => Number(v) > 0)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New supplier payment</DialogTitle>
          <DialogDescription>
            Pick the bills this pays. Anything not put against a bill is held as an advance until a bill arrives.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Supplier" htmlFor="pay-supplier">
              <select id="pay-supplier" className={SELECT} value={supplierId} onChange={(e) => changeScope(() => setSupplierId(e.target.value))}>
                <option value="">Choose a supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Payment date" htmlFor="pay-date">
              <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field
              label="Currency"
              htmlFor="pay-currency"
              hint={currency === "USD" ? "Converted at the rate in force on the payment date. Any gap to the bills' own rates is posted as an exchange gain or loss." : undefined}
            >
              <select id="pay-currency" className={SELECT} value={currency} onChange={(e) => changeScope(() => setCurrency(e.target.value as "BDT" | "USD"))}>
                <option value="BDT">BDT</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label={`Amount paid (${currency})`} htmlFor="pay-amount">
              <Input id="pay-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Reference" htmlFor="pay-ref" hint="Cheque number, bank reference or transaction ID.">
              <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
          </div>

          <section className="space-y-2">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Bills this pays</h3>
            {!supplierId ? (
              <p className={`text-[12.5px] ${TONE.muted}`}>Choose a supplier to see their open bills.</p>
            ) : candidates.length === 0 ? (
              <p className={`text-[12.5px] ${TONE.muted}`}>
                {currency === "USD"
                  ? "This supplier has no open USD bills. The whole payment will be held as an advance."
                  : "This supplier has no open approved bills. The whole payment will be held as an advance."}
              </p>
            ) : (
              candidates.map((row) => {
                const key = keyOf(row)
                const on = key in picked
                return (
                  <div key={key} className="flex flex-wrap items-center gap-3 rounded-md border border-[#E4E9EF] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <CheckboxField
                        label={`${row.label}, due ${formatDate(row.dueDate)}, ${formatMoney(leftOn(row).toFixed(2), currency)} left`}
                        checked={on}
                        onChange={(next) => toggle(row, next)}
                      />
                    </div>
                    {on ? (
                      <Input
                        aria-label={`Amount against ${row.label}`}
                        className="w-40"
                        type="number"
                        min={0}
                        max={leftOn(row)}
                        step="0.01"
                        value={picked[key]}
                        onChange={(e) => setPicked((all) => ({ ...all, [key]: e.target.value }))}
                      />
                    ) : null}
                  </div>
                )
              })
            )}
          </section>

          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-[12.5px] tabular-nums">
            <span className={TONE.muted}>Against bills {formatMoney(allocated.toFixed(2), currency)}</span>
            <span className={advance < -0.001 ? "font-bold text-[#B03A3A]" : "font-bold"}>
              {advance < -0.001
                ? `${formatMoney(Math.abs(advance).toFixed(2), currency)} more than was paid`
                : `Held as an advance ${formatMoney(advance.toFixed(2), currency)}`}
            </span>
          </div>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={!canSubmit}
            submitLabel="Save as draft"
            onCancel={onClose}
            onSubmit={() => {
              const allocations: Array<{ billId: string; amount: string }> = []
              let openingAllocation: { amount: string } | undefined
              for (const [key, value] of Object.entries(picked)) {
                const row = candidates.find((r) => keyOf(r) === key)
                if (row?.billId) allocations.push({ billId: row.billId, amount: value })
                else if (row?.openingBalanceId) openingAllocation = { amount: value }
              }
              onSave({
                supplierId,
                date,
                currency,
                amount,
                reference: reference.trim() || undefined,
                allocations,
                openingAllocation,
              })
            }}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MatchAdvanceDialog({
  payment,
  available,
  openBills,
  pending,
  error,
  onClose,
  onSave,
}: {
  payment: SupplierPayment
  available: number
  openBills: SupplierAgeingRow[]
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (target: { billId?: string; openingBalanceId?: string }, amount: string) => void
}) {
  const [targetKey, setTargetKey] = useState("")
  const [amount, setAmount] = useState("")
  const keyOf = (r: SupplierAgeingRow) => r.billId ?? r.openingBalanceId!
  const row = openBills.find((r) => keyOf(r) === targetKey)
  const cap = row ? Math.min(available, Number(row.outstanding)) : available

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Match advance to a bill</DialogTitle>
          <DialogDescription>
            {formatMoney(available.toFixed(2), "BDT")} of the payment dated {formatDate(payment.date)} is held as an
            advance. Matching moves part of it against a bill that has since arrived, or the opening balance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {openBills.length === 0 ? (
            <p className={`text-[12.5px] ${TONE.muted}`}>This supplier has no open approved bills to match against yet.</p>
          ) : (
            <>
              <Field label="Bill" htmlFor="match-bill">
                <select
                  id="match-bill"
                  className={SELECT}
                  value={targetKey}
                  onChange={(e) => {
                    setTargetKey(e.target.value)
                    const r = openBills.find((x) => keyOf(x) === e.target.value)
                    if (r) setAmount(Math.min(available, Number(r.outstanding)).toFixed(2))
                  }}
                >
                  <option value="">Choose a bill</option>
                  {openBills.map((r) => (
                    <option key={keyOf(r)} value={keyOf(r)}>
                      {r.label}, {formatMoney(r.outstanding, "BDT")} left
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount (BDT)" htmlFor="match-amount" hint={targetKey ? `At most ${formatMoney(cap.toFixed(2), "BDT")}.` : undefined}>
                <Input id="match-amount" type="number" min={0} max={cap} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </>
          )}
          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={!targetKey || !(Number(amount) > 0) || Number(amount) > cap + 0.001}
            submitLabel="Match"
            onCancel={onClose}
            onSubmit={() => row && onSave(row.billId ? { billId: row.billId } : { openingBalanceId: row.openingBalanceId! }, amount)}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
