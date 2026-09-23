"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiCheckLine } from "@remixicon/react"

import { listSupplierBills } from "@/lib/api/supplierBill"
import {
  approveSupplierCreditNote,
  createSupplierCreditNote,
  listSupplierCreditNotes,
  type SupplierCreditNoteInput,
} from "@/lib/api/supplierCreditNote"
import { listSuppliers } from "@/lib/api/supplier"
import { useSession } from "@/lib/auth/session-context"
import type { SupplierBill, SupplierCreditNote } from "@/lib/api/types"
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
import { Textarea } from "@/components/ui/textarea"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function noteTotal(note: SupplierCreditNote): string {
  return note.lines.reduce((s, l) => s + Number(l.amount) + Number(l.vatAmount), 0).toFixed(2)
}

export function SupplierCreditNotePage() {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [approving, setApproving] = useState<SupplierCreditNote | null>(null)
  const [error, setError] = useState<string | null>(null)

  const notes = useQuery({
    queryKey: ["supplier-credit-notes"],
    queryFn: () => listSupplierCreditNotes(accessToken!),
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

  const supplierName = useMemo(() => {
    const byId = new Map((suppliers.data ?? []).map((s) => [s.id, s.name]))
    return (id: string) => byId.get(id) ?? "Unknown supplier"
  }, [suppliers.data])

  const billNumber = useMemo(() => {
    const byId = new Map((bills.data ?? []).map((b) => [b.id, b.billNumber]))
    return (id: string) => byId.get(id) ?? "a bill"
  }, [bills.data])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["supplier-credit-notes"] })
    queryClient.invalidateQueries({ queryKey: ["supplier-ageing"] })
  }

  const create = useMutation({
    mutationFn: (input: SupplierCreditNoteInput) => createSupplierCreditNote(accessToken!, input),
    onSuccess: () => {
      setCreating(false)
      setError(null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const approve = useMutation({
    mutationFn: (id: string) => approveSupplierCreditNote(accessToken!, id),
    onSuccess: () => {
      setApproving(null)
      refresh()
    },
    onError: (err) => {
      setApproving(null)
      setError(toMessage(err))
    },
  })

  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const add = () => {
    setError(null)
    setCreating(true)
  }

  const rows: TableCell[][] = (notes.data ?? []).map((n) => {
    const canApprove = n.status === "DRAFT" && isSuperAdmin && n.createdBy !== user?.id
    return [
      { text: supplierName(n.supplierId), sub: `Against ${billNumber(n.billId)}`, weight: 600 },
      { text: formatDate(n.date) },
      { text: n.reason },
      { text: formatMoney(noteTotal(n), "BDT") },
      { node: <Badge variant={n.status === "APPROVED" ? "default" : "secondary"}>{n.status === "APPROVED" ? "Approved" : "Draft"}</Badge> },
      {
        node: canApprove ? (
          <RowActions
            actions={[{
              kind: "custom",
              label: "Approve",
              icon: <RiCheckLine className="size-3.5" aria-hidden />,
              onClick: () => { setError(null); setApproving(n) },
            }]}
          />
        ) : null,
      },
    ]
  })

  const approvedBills = (bills.data ?? []).filter((b) => b.status === "APPROVED")

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Supplier credit notes"
        sub="Reducing what we owe a supplier, always against an approved bill and always with a reason on record."
        cta="New credit note"
        onCta={add}
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      <PanelTable
        cols="1.4fr 0.8fr 1.8fr 1fr 0.7fr 0.9fr"
        headers={["Supplier", "Date", "Reason", "Credit", "Status", ""]}
        rows={rows}
        isLoading={notes.isPending}
        isError={notes.isError}
        onRetry={() => notes.refetch()}
        emptyTitle="No supplier credit notes yet"
        emptyBody="Raise one when a supplier agrees to reduce an approved bill, for returned goods or a pricing correction."
        emptyAction="New credit note"
        onEmptyAction={add}
      />

      {creating ? (
        <CreditNoteDialog
          bills={approvedBills}
          supplierName={supplierName}
          pending={create.isPending}
          error={error}
          onClose={() => setCreating(false)}
          onSave={(input) => create.mutate(input)}
        />
      ) : null}

      <ConfirmDialog
        open={approving !== null}
        title="Approve this credit note?"
        body={
          approving
            ? `This posts a ${formatMoney(noteTotal(approving), "BDT")} reduction in what we owe ${supplierName(approving.supplierId)}. It cannot be edited after approval.`
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

interface PickedLine {
  amount: string
  vatAmount: string
}

function CreditNoteDialog({
  bills,
  supplierName,
  pending,
  error,
  onClose,
  onSave,
}: {
  bills: SupplierBill[]
  supplierName: (id: string) => string
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: SupplierCreditNoteInput) => void
}) {
  const [billId, setBillId] = useState("")
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState("")
  const [picked, setPicked] = useState<Record<string, PickedLine>>({})

  const bill = bills.find((b) => b.id === billId)

  // VAT is suggested in the same proportion as the bill line's own VAT, and
  // stays editable.
  const vatFor = (lineId: string, amount: string): string => {
    const line = bill?.lines.find((l) => l.id === lineId)
    if (!line || Number(line.amount) === 0) return "0"
    return ((Number(amount) || 0) * (Number(line.vatAmount) / Number(line.amount))).toFixed(2)
  }

  const total = Object.values(picked).reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.vatAmount) || 0), 0)

  const canSubmit =
    Boolean(billId && date && reason.trim()) &&
    Object.keys(picked).length > 0 &&
    Object.values(picked).every((l) => Number(l.amount) > 0 && Number(l.vatAmount) >= 0)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New supplier credit note</DialogTitle>
          <DialogDescription>
            Choose the bill and the lines being reduced. Goods not yet delivered come back out of stock bought for
            the deal; services come off the cost they were charged to.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          {bills.length === 0 ? (
            <PanelAlert>There are no approved supplier bills yet, so there is nothing a credit note could reduce.</PanelAlert>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Bill" htmlFor="cn-bill">
              <select
                id="cn-bill"
                className={SELECT}
                value={billId}
                onChange={(e) => {
                  setBillId(e.target.value)
                  setPicked({})
                }}
              >
                <option value="">Choose an approved bill</option>
                {bills.map((b) => (
                  <option key={b.id} value={b.id}>{supplierName(b.supplierId)} · {b.billNumber}</option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="cn-date">
              <Input id="cn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <Field label="Reason" htmlFor="cn-reason" hint="Required. Kept on record with the entry.">
            <Textarea id="cn-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Two firewalls returned, faulty on arrival" />
          </Field>

          {bill ? (
            <section className="space-y-2">
              <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines being reduced</h3>
              {bill.lines.map((line) => {
                const on = line.id in picked
                return (
                  <div key={line.id} className="space-y-2 rounded-md border border-[#E4E9EF] px-3 py-2">
                    <CheckboxField
                      label={`${line.description} (${line.kind === "GOODS" ? "goods" : "service"}), ${formatMoney(line.amount, "BDT")} plus ${formatMoney(line.vatAmount, "BDT")} VAT`}
                      checked={on}
                      onChange={(next) =>
                        setPicked((all) => {
                          const copy = { ...all }
                          if (next) copy[line.id] = { amount: line.amount, vatAmount: line.vatAmount }
                          else delete copy[line.id]
                          return copy
                        })
                      }
                    />
                    {on ? (
                      <div className="grid grid-cols-2 gap-2 pl-6">
                        <Field label="Amount (BDT)" htmlFor={`cn-amt-${line.id}`}>
                          <Input
                            id={`cn-amt-${line.id}`}
                            type="number"
                            min={0}
                            step="0.01"
                            value={picked[line.id].amount}
                            onChange={(e) =>
                              setPicked((all) => ({ ...all, [line.id]: { amount: e.target.value, vatAmount: vatFor(line.id, e.target.value) } }))
                            }
                          />
                        </Field>
                        <Field label="VAT (BDT)" htmlFor={`cn-vat-${line.id}`}>
                          <Input
                            id={`cn-vat-${line.id}`}
                            type="number"
                            min={0}
                            step="0.01"
                            value={picked[line.id].vatAmount}
                            onChange={(e) => setPicked((all) => ({ ...all, [line.id]: { ...all[line.id], vatAmount: e.target.value } }))}
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <p className="text-right text-[12.5px] font-bold tabular-nums">Credit {formatMoney(total.toFixed(2), "BDT")}</p>
            </section>
          ) : null}

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={!canSubmit}
            submitLabel="Save as draft"
            onCancel={onClose}
            onSubmit={() =>
              onSave({
                billId,
                date,
                reason: reason.trim(),
                lines: Object.entries(picked).map(([billLineId, l]) => ({ billLineId, amount: l.amount, vatAmount: l.vatAmount })),
              })
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
