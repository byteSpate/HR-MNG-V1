"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiCheckLine } from "@remixicon/react"

import {
  approveCustomerCreditNote,
  createCustomerCreditNote,
  listCustomerCreditNotes,
  type CustomerCreditNoteInput,
} from "@/lib/api/customerCreditNote"
import { listInvoices } from "@/lib/api/invoice"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerCreditNote, Invoice } from "@/lib/api/types"
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

function noteTotal(note: CustomerCreditNote): string {
  return note.lines.reduce((s, l) => s + Number(l.amount) + Number(l.vatAmount), 0).toFixed(2)
}

export function CustomerCreditNotePage() {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [approving, setApproving] = useState<CustomerCreditNote | null>(null)
  const [error, setError] = useState<string | null>(null)

  const notes = useQuery({
    queryKey: ["customer-credit-notes"],
    queryFn: () => listCustomerCreditNotes(accessToken!),
    enabled: Boolean(accessToken),
  })
  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: () => listInvoices(accessToken!),
    enabled: Boolean(accessToken),
  })

  const invoiceNumber = useMemo(() => {
    const byId = new Map((invoices.data ?? []).map((i) => [i.id, i.invoiceNumber]))
    return (id: string) => byId.get(id) ?? "an invoice"
  }, [invoices.data])
  const customerFor = useMemo(() => {
    const byId = new Map((invoices.data ?? []).map((i) => [i.id, i.customer.legalName]))
    return (id: string) => byId.get(id) ?? "Unknown customer"
  }, [invoices.data])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["customer-credit-notes"] })
    queryClient.invalidateQueries({ queryKey: ["customer-ageing"] })
    queryClient.invalidateQueries({ queryKey: ["customer-tie-out"] })
  }

  const create = useMutation({
    mutationFn: (input: CustomerCreditNoteInput) => createCustomerCreditNote(accessToken!, input),
    onSuccess: () => { setCreating(false); setError(null); refresh() },
    onError: (err) => setError(toMessage(err)),
  })

  const approve = useMutation({
    mutationFn: (id: string) => approveCustomerCreditNote(accessToken!, id),
    onSuccess: () => { setApproving(null); refresh() },
    onError: (err) => { setApproving(null); setError(toMessage(err)) },
  })

  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const rows: TableCell[][] = (notes.data ?? []).map((n) => {
    const canApprove = n.status === "DRAFT" && isSuperAdmin && n.createdBy !== user?.id
    return [
      { text: customerFor(n.invoice.id), sub: `Against ${invoiceNumber(n.invoice.id)}`, weight: 600 },
      { text: formatDate(n.date) },
      { text: n.reason },
      { text: formatMoney(noteTotal(n), "BDT") },
      { node: <Badge variant={n.status === "APPROVED" ? "default" : "secondary"}>{n.status === "APPROVED" ? "Approved" : "Draft"}</Badge> },
      {
        node: canApprove ? (
          <RowActions
            actions={[{ kind: "custom", label: "Approve", icon: <RiCheckLine className="size-3.5" aria-hidden />, onClick: () => { setError(null); setApproving(n) } }]}
          />
        ) : null,
      },
    ]
  })

  const approvedInvoices = (invoices.data ?? []).filter((i) => i.status === "APPROVED")

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Customer credit notes"
        sub="Reducing what a customer owes on an approved invoice, for returned goods or a corrected price."
        cta="New credit note"
        onCta={() => { setError(null); setCreating(true) }}
      />
      <p className={`text-[12px] ${TONE.muted}`}>
        If the goods came back to us, also record a supplier credit note when the supplier takes them back. A customer credit note does not return goods to stock.
      </p>

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      <PanelTable
        cols="1.4fr 0.8fr 1.8fr 1fr 0.7fr 0.9fr"
        headers={["Customer", "Date", "Reason", "Credit", "Status", ""]}
        rows={rows}
        isLoading={notes.isPending}
        isError={notes.isError}
        onRetry={() => notes.refetch()}
        emptyTitle="No customer credit notes yet"
        emptyBody="Raise one when a customer's approved invoice needs reducing, for returned goods or a pricing correction."
        emptyAction="New credit note"
        onEmptyAction={() => { setError(null); setCreating(true) }}
      />

      {creating ? (
        <CreditNoteDialog
          invoices={approvedInvoices}
          existingNotes={notes.data ?? []}
          pending={create.isPending}
          error={error}
          onClose={() => setCreating(false)}
          onSave={(input) => create.mutate(input)}
        />
      ) : null}

      <ConfirmDialog
        open={approving !== null}
        title="Approve this credit note?"
        body={approving ? `Approving reverses the sale and its VAT for the amount credited, dated ${formatDate(approving.date)}.` : ""}
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
}

function CreditNoteDialog({
  invoices,
  existingNotes,
  pending,
  error,
  onClose,
  onSave,
}: {
  invoices: Invoice[]
  existingNotes: CustomerCreditNote[]
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: CustomerCreditNoteInput) => void
}) {
  const [invoiceId, setInvoiceId] = useState("")
  const [date, setDate] = useState(today())
  const [reason, setReason] = useState("")
  const [picked, setPicked] = useState<Record<string, PickedLine>>({})

  const invoice = invoices.find((i) => i.id === invoiceId)

  // Left to credit counts draft and approved credit notes already on this
  // line, matching the server's own cap.
  const alreadyCredited = (invoiceLineId: string): number =>
    existingNotes
      .filter((n) => n.invoice.id === invoiceId)
      .flatMap((n) => n.lines)
      .filter((l) => l.invoiceLineId === invoiceLineId)
      .reduce((s, l) => s + Number(l.amount), 0)

  const total = Object.values(picked).reduce((s, l) => s + (Number(l.amount) || 0), 0)

  const canSubmit =
    Boolean(invoiceId && date && reason.trim()) &&
    Object.keys(picked).length > 0 &&
    Object.entries(picked).every(([lineId, l]) => {
      const line = invoice?.lines.find((il) => il.id === lineId)
      const left = line ? Number(line.amount) - alreadyCredited(lineId) : 0
      return Number(l.amount) > 0 && Number(l.amount) <= left
    })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New customer credit note</DialogTitle>
          <DialogDescription>Choose the invoice and the lines being reduced. VAT is worked out by the server.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          {invoices.length === 0 ? (
            <PanelAlert>There are no approved invoices yet, so there is nothing a credit note could reduce.</PanelAlert>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Invoice" htmlFor="ccn-invoice">
              <select id="ccn-invoice" className={SELECT} value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setPicked({}) }}>
                <option value="">Choose an approved invoice</option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>{i.customer.legalName} · {i.invoiceNumber}</option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="ccn-date">
              <Input id="ccn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <Field label="Reason" htmlFor="ccn-reason" hint="Required. Kept on record with the entry.">
            <Textarea id="ccn-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the customer is being credited" />
          </Field>

          {invoice ? (
            <section className="space-y-2">
              <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines being reduced</h3>
              {invoice.lines.map((line) => {
                const left = Number(line.amount) - alreadyCredited(line.id)
                const on = line.id in picked
                const rate = Number(line.amount) > 0 ? Number(line.vatAmount) / Number(line.amount) : 0
                const previewVat = on ? (Number(picked[line.id].amount) || 0) * rate : 0
                return (
                  <div key={line.id} className="space-y-2 rounded-md border border-[#E4E9EF] px-3 py-2">
                    <CheckboxField
                      label={`${line.description}, ${formatMoney(left.toFixed(2), "BDT")} left to credit`}
                      checked={on}
                      disabled={left <= 0}
                      onChange={(next) =>
                        setPicked((all) => {
                          const copy = { ...all }
                          if (next) copy[line.id] = { amount: left.toFixed(2) }
                          else delete copy[line.id]
                          return copy
                        })
                      }
                    />
                    {on ? (
                      <div className="pl-6">
                        <Field label="Amount (BDT)" htmlFor={`ccn-amt-${line.id}`} hint={`Preview VAT ${formatMoney(previewVat.toFixed(2), "BDT")}, worked out again by the server.`}>
                          <Input
                            id={`ccn-amt-${line.id}`}
                            type="number"
                            min={0}
                            max={left}
                            step="0.01"
                            value={picked[line.id].amount}
                            onChange={(e) => setPicked((all) => ({ ...all, [line.id]: { amount: e.target.value } }))}
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <p className="text-right text-[12.5px] font-bold tabular-nums">Credit {formatMoney(total.toFixed(2), "BDT")} before VAT</p>
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
                invoiceId,
                date,
                reason: reason.trim(),
                lines: Object.entries(picked).map(([invoiceLineId, l]) => ({ invoiceLineId, amount: l.amount })),
              })
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
