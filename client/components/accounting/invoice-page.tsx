"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiCheckLine } from "@remixicon/react"

import {
  approveInvoice,
  createInvoice,
  listInvoiceablePos,
  listInvoices,
  updateInvoice,
  type InvoiceInput,
} from "@/lib/api/invoice"
import { listVatCodes } from "@/lib/api/vatCode"
import { useSession } from "@/lib/auth/session-context"
import type { Invoice, InvoiceablePo, VatCode } from "@/lib/api/types"
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
import { Skeleton } from "@/components/ui/skeleton"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function invoiceTotals(inv: Invoice): { net: string; vat: string; total: string } {
  const net = inv.lines.reduce((s, l) => s + Number(l.amount), 0)
  const vat = inv.lines.reduce((s, l) => s + Number(l.vatAmount), 0)
  return { net: net.toFixed(2), vat: vat.toFixed(2), total: (net + vat).toFixed(2) }
}

function InvoicePageInner() {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [creating, setCreating] = useState<"new" | null>(() => (searchParams.get("po") ? "new" : null))
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [approving, setApproving] = useState<Invoice | null>(null)
  const [error, setError] = useState<string | null>(null)

  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: () => listInvoices(accessToken!),
    enabled: Boolean(accessToken),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["invoices"] })
    queryClient.invalidateQueries({ queryKey: ["customer-pos"] })
  }

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: InvoiceInput }) =>
      id === null ? createInvoice(accessToken!, input) : updateInvoice(accessToken!, id, input),
    onSuccess: () => {
      setCreating(null)
      setEditing(null)
      setError(null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const approve = useMutation({
    mutationFn: (id: string) => approveInvoice(accessToken!, id),
    onSuccess: () => {
      setApproving(null)
      queryClient.invalidateQueries({ queryKey: ["invoices"] })
      queryClient.invalidateQueries({ queryKey: ["customer-pos"] })
      queryClient.invalidateQueries({ queryKey: ["customer-ageing"] })
      queryClient.invalidateQueries({ queryKey: ["customer-tie-out"] })
    },
    onError: (err) => {
      setApproving(null)
      setError(toMessage(err))
    },
  })

  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const rows: TableCell[][] = (invoices.data ?? []).map((inv) => {
    const { net, vat, total } = invoiceTotals(inv)
    const canApprove = inv.status === "DRAFT" && isSuperAdmin && inv.createdBy !== user?.id
    const actions = [
      ...(inv.status === "DRAFT" ? [{ kind: "edit" as const, label: "Edit", onClick: () => { setError(null); setEditing(inv) } }] : []),
      ...(canApprove
        ? [{ kind: "custom" as const, label: "Approve", icon: <RiCheckLine className="size-3.5" aria-hidden />, onClick: () => { setError(null); setApproving(inv) } }]
        : []),
    ]
    return [
      { text: inv.invoiceNumber, weight: 600 },
      { text: inv.customer.legalName },
      { text: inv.po.serial, sub: inv.po.customerPoNumber },
      { text: inv.po.opportunity.serial },
      { text: formatDate(inv.date) },
      { text: formatDate(inv.dueDate) },
      { text: formatMoney(net, "BDT") },
      { text: formatMoney(vat, "BDT") },
      { text: formatMoney(total, "BDT") },
      { node: <Badge variant={inv.status === "APPROVED" ? "default" : "secondary"}>{inv.status === "APPROVED" ? "Approved" : "Draft"}</Badge> },
      { node: actions.length > 0 ? <RowActions actions={actions} /> : null },
    ]
  })

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Invoices"
        sub="Invoices you have issued to customers, recorded here so they reach the ledger. Approval posts the sale."
        cta="New invoice"
        onCta={() => { setError(null); setCreating("new") }}
      />
      <p className={`text-[12px] ${TONE.muted}`}>
        Invoices are issued from your usual invoicing tool. This page records them; it does not print them.
      </p>

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      <PanelTable
        cols="1fr 1.2fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr 0.8fr 0.9fr 0.8fr 0.9fr"
        headers={["Invoice", "Customer", "PO", "Deal", "Date", "Due", "Net", "VAT", "Total", "Status", ""]}
        rows={rows}
        isLoading={invoices.isPending}
        isError={invoices.isError}
        onRetry={() => invoices.refetch()}
        emptyTitle="No invoices yet"
        emptyBody="Record one once a customer PO has something left to invoice."
        emptyAction="New invoice"
        onEmptyAction={() => { setError(null); setCreating("new") }}
      />

      {creating ? (
        <InvoiceDialog
          invoice={null}
          preselectedPoId={searchParams.get("po")}
          pending={save.isPending}
          error={error}
          onClose={() => setCreating(null)}
          onSave={(input) => save.mutate({ id: null, input })}
        />
      ) : null}

      {editing ? (
        <InvoiceDialog
          invoice={editing}
          preselectedPoId={null}
          pending={save.isPending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate({ id: editing.id, input })}
        />
      ) : null}

      <ConfirmDialog
        open={approving !== null}
        title={`Approve invoice ${approving?.invoiceNumber ?? ""}?`}
        body={
          approving
            ? `Approving posts the sale, its VAT and the cost of the goods sold to the ledger, dated ${formatDate(approving.date)}. It cannot be edited afterwards; a mistake is corrected with a credit note.`
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

export function InvoicePage() {
  // useSearchParams forces client rendering up to the nearest Suspense boundary.
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <InvoicePageInner />
    </Suspense>
  )
}

interface InvoiceLineDraft {
  poLineId: string
  description: string
  remaining: string
  vatCodeId: string
  amount: string
}

function InvoiceDialog({
  invoice,
  preselectedPoId,
  pending,
  error,
  onClose,
  onSave,
}: {
  invoice: Invoice | null
  preselectedPoId: string | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: InvoiceInput) => void
}) {
  const { accessToken } = useSession()
  const vatCodes = useQuery({
    queryKey: ["vat-codes"],
    queryFn: () => listVatCodes(accessToken!),
    enabled: Boolean(accessToken),
  })
  const invoicablePos = useQuery({
    queryKey: ["invoiceable-pos"],
    queryFn: () => listInvoiceablePos(accessToken!),
    enabled: Boolean(accessToken) && !invoice,
  })
  const codes: VatCode[] = vatCodes.data ?? []
  const pos: InvoiceablePo[] = invoicablePos.data ?? []

  const [poId, setPoId] = useState(invoice ? invoice.po.id : preselectedPoId ?? "")
  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoiceNumber ?? "")
  const [date, setDate] = useState(invoice ? invoice.date.slice(0, 10) : today())
  const [dueDate, setDueDate] = useState(invoice ? invoice.dueDate.slice(0, 10) : "")
  const [lines, setLines] = useState<InvoiceLineDraft[]>(
    invoice
      ? invoice.lines.map((l) => ({ poLineId: l.poLineId, description: l.description, remaining: "", vatCodeId: l.vatCodeId, amount: l.amount }))
      : []
  )

  const selectedPo = invoice ? null : pos.find((p) => p.id === poId)

  // Seed the line drafts from the chosen PO's lines, once, when it changes.
  const [seededFor, setSeededFor] = useState<string | null>(invoice ? invoice.po.id : null)
  if (!invoice && selectedPo && seededFor !== selectedPo.id) {
    setSeededFor(selectedPo.id)
    setLines(
      selectedPo.lines
        .filter((l) => Number(l.remaining) > 0)
        .map((l) => ({ poLineId: l.id, description: l.description, remaining: l.remaining, vatCodeId: l.vatCodeId, amount: "" }))
    )
  }

  const update = (poLineId: string, patch: Partial<InvoiceLineDraft>) =>
    setLines((all) => all.map((l) => (l.poLineId === poLineId ? { ...l, ...patch } : l)))

  const rateOf = (id: string) => Number((vatCodes.data ?? []).find((c) => c.id === id)?.ratePercent ?? 0)
  const filled = lines.filter((l) => Number(l.amount) > 0)
  const net = filled.reduce((s, l) => s + Number(l.amount), 0)
  const vat = filled.reduce((s, l) => s + Math.round((Number(l.amount) || 0) * rateOf(l.vatCodeId)) / 100, 0)

  const canSubmit = Boolean(poId && invoiceNumber.trim() && date && filled.length > 0)

  const submit = () =>
    onSave({
      poId,
      invoiceNumber: invoiceNumber.trim(),
      date,
      dueDate: dueDate || undefined,
      lines: filled.map((l) => ({ poLineId: l.poLineId, description: l.description.trim() || undefined, amount: l.amount, vatCodeId: l.vatCodeId })),
    })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{invoice ? `Edit invoice ${invoice.invoiceNumber}` : "New invoice"}</DialogTitle>
          <DialogDescription>Bill against what is left to invoice on a customer PO.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          {!invoice && invoicablePos.isSuccess && pos.length === 0 ? (
            <PanelAlert>
              Nothing is waiting to be invoiced. Record a{" "}
              <Link href="/finance/accounting/customer-pos" className="underline">Customer POs</Link> first.
            </PanelAlert>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer PO" htmlFor="inv-po">
              {invoice ? (
                <div className="flex h-9 items-center rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 text-sm">
                  {invoice.po.serial} · {invoice.customer.legalName} · {invoice.po.customerPoNumber}
                </div>
              ) : (
                <select id="inv-po" className={SELECT} value={poId} onChange={(e) => setPoId(e.target.value)}>
                  <option value="">Choose a customer PO</option>
                  {pos.map((p) => (
                    <option key={p.id} value={p.id}>{p.serial} · {p.customer.legalName} · {p.customerPoNumber}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Invoice number" htmlFor="inv-number" hint="Required.">
              <Input id="inv-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="As printed on the invoice" />
            </Field>
            <Field label="Date" htmlFor="inv-date">
              <Input id="inv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Due date" htmlFor="inv-due" hint="Leave blank for the customer's payment terms.">
              <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>

          {lines.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Lines</h3>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((all) => all.map((l) => ({ ...l, amount: l.remaining || l.amount })))}>
                  Bill all that is left
                </Button>
              </div>
              {lines.map((line) => (
                <div key={line.poLineId} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                  <Input
                    aria-label={`${line.description} description`}
                    className="sm:col-span-5"
                    value={line.description}
                    onChange={(e) => update(line.poLineId, { description: e.target.value })}
                  />
                  <div className={`flex items-center text-[12px] sm:col-span-2 ${TONE.muted}`}>
                    Left {line.remaining ? formatMoney(line.remaining, "BDT") : "—"}
                  </div>
                  <Input
                    aria-label={`${line.description} amount`}
                    className="sm:col-span-2"
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.amount}
                    onChange={(e) => update(line.poLineId, { amount: e.target.value })}
                    placeholder="Amount"
                  />
                  <select
                    aria-label={`${line.description} VAT`}
                    className={`${SELECT} sm:col-span-3`}
                    value={line.vatCodeId}
                    onChange={(e) => update(line.poLineId, { vatCodeId: e.target.value })}
                  >
                    {codes.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ))}

              <p className={`text-right text-[12.5px] ${TONE.muted}`}>
                Net {formatMoney(net.toFixed(2), "BDT")} · VAT {formatMoney(vat.toFixed(2), "BDT")} · Total {formatMoney((net + vat).toFixed(2), "BDT")} (worked out again by the server on save)
              </p>
            </section>
          ) : null}

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={!canSubmit}
            submitLabel={invoice ? "Save draft" : "Save as draft"}
            onCancel={onClose}
            onSubmit={submit}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
