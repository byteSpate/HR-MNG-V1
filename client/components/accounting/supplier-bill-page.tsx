"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine, RiCheckLine, RiDeleteBinLine } from "@remixicon/react"

import {
  approveSupplierBill,
  createSupplierBill,
  listBillableOpportunities,
  listSupplierBills,
  updateSupplierBill,
  type SupplierBillInput,
  type SupplierBillLineInput,
} from "@/lib/api/supplierBill"
import { listSuppliers } from "@/lib/api/supplier"
import { listVatCodes } from "@/lib/api/vatCode"
import { useSession } from "@/lib/auth/session-context"
import type { BillableOpportunity, Supplier, SupplierBill, VatCode } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import {
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
import { Button } from "@/components/ui/button"
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

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function billTotal(bill: SupplierBill): string {
  return bill.lines.reduce((sum, l) => sum + Number(l.amount) + Number(l.vatAmount), 0).toFixed(2)
}

export function SupplierBillPage() {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<SupplierBill | "new" | null>(null)
  const [approving, setApproving] = useState<SupplierBill | null>(null)
  const [error, setError] = useState<string | null>(null)

  const bills = useQuery({
    queryKey: ["supplier-bills"],
    queryFn: () => listSupplierBills(accessToken!),
    enabled: Boolean(accessToken),
  })
  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => listSuppliers(accessToken!),
    enabled: Boolean(accessToken),
  })

  const supplierName = useMemo(() => {
    const byId = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]))
    return (id: string) => byId.get(id) ?? "Unknown supplier"
  }, [suppliers.data])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-bills"] })
    queryClient.invalidateQueries({ queryKey: ["supplier-ageing"] })
  }

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: SupplierBillInput }) =>
      id === null ? createSupplierBill(accessToken!, input) : updateSupplierBill(accessToken!, id, input),
    onSuccess: () => {
      setEditing(null)
      setError(null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const approve = useMutation({
    mutationFn: (id: string) => approveSupplierBill(accessToken!, id),
    onSuccess: () => {
      setApproving(null)
      refresh()
    },
    onError: (err) => {
      setApproving(null)
      setError(toMessage(err))
    },
  })

  const add = () => {
    setError(null)
    setEditing("new")
  }

  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const rows: TableCell[][] = (bills.data ?? []).map((b) => {
    const canApprove = b.status === "DRAFT" && isSuperAdmin && b.createdBy !== user?.id
    const actions = [
      ...(b.status === "DRAFT"
        ? [{ kind: "edit" as const, label: "Edit", onClick: () => { setError(null); setEditing(b) } }]
        : []),
      ...(canApprove
        ? [{
            kind: "custom" as const,
            label: "Approve",
            icon: <RiCheckLine className="size-3.5" aria-hidden />,
            onClick: () => { setError(null); setApproving(b) },
          }]
        : []),
    ]
    return [
      { text: supplierName(b.supplierId), sub: b.billNumber, weight: 600 },
      { text: formatDate(b.date) },
      { text: formatDate(b.dueDate) },
      { text: formatMoney(billTotal(b), "BDT"), sub: b.currency === "USD" ? "Entered in USD" : undefined },
      { node: <Badge variant={b.status === "APPROVED" ? "default" : "secondary"}>{b.status === "APPROVED" ? "Approved" : "Draft"}</Badge> },
      { node: actions.length > 0 ? <RowActions actions={actions} /> : null },
    ]
  })

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Supplier bills"
        sub="What we owe suppliers, one bill at a time. Approval posts the bill to the ledger."
        cta="New bill"
        onCta={add}
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      <PanelTable
        cols="1.5fr 0.9fr 0.9fr 1fr 0.7fr 1fr"
        headers={["Supplier", "Bill date", "Due", "Total", "Status", ""]}
        rows={rows}
        isLoading={bills.isPending}
        isError={bills.isError}
        onRetry={() => bills.refetch()}
        emptyTitle="No supplier bills yet"
        emptyBody="Record one when a supplier's invoice arrives for goods or services bought for a Won deal."
        emptyAction="New bill"
        onEmptyAction={add}
      />

      {editing !== null ? (
        <SupplierBillDialog
          bill={editing === "new" ? null : editing}
          suppliers={(suppliers.data ?? []).filter((s) => s.isActive || (editing !== "new" && s.id === editing.supplierId))}
          pending={save.isPending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate({ id: editing === "new" ? null : editing.id, input })}
        />
      ) : null}

      <ConfirmDialog
        open={approving !== null}
        title={`Approve bill ${approving?.billNumber ?? ""}?`}
        body={
          approving
            ? `This posts ${formatMoney(billTotal(approving), "BDT")} to the ledger as owed to ${supplierName(approving.supplierId)}. An approved bill cannot be edited; a mistake is corrected with a credit note.`
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

interface LineDraft {
  description: string
  kind: "GOODS" | "SERVICE"
  amount: string
  vatCodeId: string
  opportunityId: string
}

function blankLine(vatCodes: VatCode[]): LineDraft {
  return { description: "", kind: "GOODS", amount: "", vatCodeId: vatCodes[0]?.id ?? "", opportunityId: "" }
}

function SupplierBillDialog({
  bill,
  suppliers,
  pending,
  error,
  onClose,
  onSave,
}: {
  bill: SupplierBill | null
  suppliers: Supplier[]
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: SupplierBillInput) => void
}) {
  const { accessToken } = useSession()
  const vatCodes = useQuery({
    queryKey: ["vat-codes"],
    queryFn: () => listVatCodes(accessToken!),
    enabled: Boolean(accessToken),
  })
  const deals = useQuery({
    queryKey: ["billable-opportunities"],
    queryFn: () => listBillableOpportunities(accessToken!),
    enabled: Boolean(accessToken),
  })

  const [supplierId, setSupplierId] = useState(bill?.supplierId ?? "")
  const [billNumber, setBillNumber] = useState(bill?.billNumber ?? "")
  const [date, setDate] = useState(bill ? bill.date.slice(0, 10) : today())
  const [dueDate, setDueDate] = useState(bill ? bill.dueDate.slice(0, 10) : addDays(today(), 30))
  const [currency, setCurrency] = useState<"BDT" | "USD">(bill?.currency ?? "BDT")
  const [lines, setLines] = useState<LineDraft[]>(
    bill
      ? bill.lines.map((l) => ({
          description: l.description,
          kind: l.kind,
          amount: bill.currency === "USD" && l.sourceAmount ? l.sourceAmount : l.amount,
          vatCodeId: l.vatCodeId,
          opportunityId: l.opportunityId,
        }))
      : [blankLine([])]
  )

  const codes = vatCodes.data ?? []
  const wonDeals: BillableOpportunity[] = deals.data ?? []

  const rateOf = (id: string) => Number(codes.find((c) => c.id === (id || codes[0]?.id))?.ratePercent ?? 0)
  const net = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const vat = lines.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * rateOf(l.vatCodeId)) / 100, 0)

  const update = (i: number, patch: Partial<LineDraft>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const chooseSupplier = (id: string) => {
    setSupplierId(id)
    const s = suppliers.find((x) => x.id === id)
    if (s && !bill) setDueDate(addDays(date, s.paymentDays))
  }

  const linesComplete = lines.every(
    (l) => l.description.trim() && Number(l.amount) > 0 && (l.vatCodeId || codes[0]) && l.opportunityId
  )
  const canSubmit = Boolean(supplierId && billNumber.trim() && date && dueDate && lines.length > 0 && linesComplete)

  const submit = () =>
    onSave({
      supplierId,
      billNumber: billNumber.trim(),
      date,
      dueDate,
      currency,
      lines: lines.map<SupplierBillLineInput>((l) => ({
        description: l.description.trim(),
        kind: l.kind,
        // For a USD bill the server converts sourceAmount at the bill-date
        // rate and stores the taka figure; amount is sent only to pass the
        // schema and is replaced.
        amount: l.amount,
        ...(currency === "USD" ? { sourceAmount: l.amount } : {}),
        vatCodeId: l.vatCodeId || codes[0]?.id || "",
        opportunityId: l.opportunityId,
      })),
    })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{bill ? `Edit bill ${bill.billNumber}` : "New supplier bill"}</DialogTitle>
          <DialogDescription>
            Every line belongs to a Won deal. Goods wait as stock bought for that deal until they are
            delivered; services are a cost on the bill date.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Supplier" htmlFor="bill-supplier">
              <select id="bill-supplier" className={SELECT} value={supplierId} onChange={(e) => chooseSupplier(e.target.value)}>
                <option value="">Choose a supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Supplier's bill number" htmlFor="bill-number">
              <Input id="bill-number" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="INV-2201" />
            </Field>
            <Field label="Bill date" htmlFor="bill-date">
              <Input id="bill-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Due date" htmlFor="bill-due" hint="Filled from the supplier's payment days; change it if the bill says otherwise.">
              <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field
              label="Currency"
              htmlFor="bill-currency"
              hint={currency === "USD" ? "Converted to taka at the rate in force on the bill date, and frozen there." : undefined}
            >
              <select id="bill-currency" className={SELECT} value={currency} onChange={(e) => setCurrency(e.target.value as "BDT" | "USD")}>
                <option value="BDT">BDT</option>
                <option value="USD">USD</option>
              </select>
            </Field>
          </div>

          <section className="space-y-2">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines</h3>

            {deals.isSuccess && wonDeals.length === 0 ? (
              <PanelAlert>
                There are no Won deals yet. A supplier bill line must belong to a Won deal, so no bill can be
                recorded until one exists in the Sales Hub.
              </PanelAlert>
            ) : null}

            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                <div className="sm:col-span-12">
                  <Input
                    aria-label={`Line ${i + 1} description`}
                    value={line.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="Fortinet FortiGate 100F, 2 units"
                  />
                </div>
                <select aria-label={`Line ${i + 1} kind`} className={`${SELECT} sm:col-span-2`} value={line.kind} onChange={(e) => update(i, { kind: e.target.value as "GOODS" | "SERVICE" })}>
                  <option value="GOODS">Goods</option>
                  <option value="SERVICE">Service</option>
                </select>
                <Input
                  aria-label={`Line ${i + 1} amount`}
                  className="sm:col-span-3"
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                  placeholder={`Amount (${currency})`}
                />
                <select aria-label={`Line ${i + 1} VAT`} className={`${SELECT} sm:col-span-2`} value={line.vatCodeId || codes[0]?.id || ""} onChange={(e) => update(i, { vatCodeId: e.target.value })}>
                  {codes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select aria-label={`Line ${i + 1} deal`} className={`${SELECT} sm:col-span-4`} value={line.opportunityId} onChange={(e) => update(i, { opportunityId: e.target.value })}>
                  <option value="">Which deal?</option>
                  {wonDeals.map((d) => (
                    <option key={d.id} value={d.id}>{d.serial} · {d.accountName} · {d.name}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove line ${i + 1}`}
                  className="sm:col-span-1"
                  disabled={lines.length === 1}
                  onClick={() => setLines((all) => all.filter((_, j) => j !== i))}
                >
                  <RiDeleteBinLine className="size-4" aria-hidden />
                </Button>
              </div>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => [...all, blankLine(codes)])}>
              <RiAddLine className="size-4" aria-hidden /> Add line
            </Button>
          </section>

          <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-[12.5px] tabular-nums">
            <span className={TONE.muted}>Net {formatMoney(net.toFixed(2), currency)}</span>
            <span className={TONE.muted}>VAT {formatMoney(vat.toFixed(2), currency)}</span>
            <span className="font-bold">Total {formatMoney((net + vat).toFixed(2), currency)}</span>
          </div>
          <p className={`text-right text-[11.5px] ${TONE.muted}`}>A preview. The saved figures are worked out by the server.</p>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={!canSubmit}
            submitLabel={bill ? "Save draft" : "Save as draft"}
            onCancel={onClose}
            onSubmit={submit}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
