"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiCheckLine, RiFileTextLine, RiSwapLine } from "@remixicon/react"

import {
  approveReceipt,
  createReceipt,
  listReceipts,
  matchCustomerAdvance,
  updateReceiptCertificates,
  type CertificatesInput,
  type ReceiptInput,
} from "@/lib/api/receipt"
import { getCustomerAgeing } from "@/lib/api/receivables"
import { listCustomers } from "@/lib/api/customer"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerAgeingRow, Receipt } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import {
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
import { Tag } from "@/components/dashboard/tag"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function settled(r: Receipt): number {
  return r.allocations.reduce((s, a) => s + Number(a.amount), 0) + r.openingAllocations.reduce((s, a) => s + Number(a.amount), 0)
}
function advance(r: Receipt): number {
  return Number(r.amount) + Number(r.vdsAmount) + Number(r.aitAmount) - settled(r)
}

type Filter = "all" | "missing"

export function ReceiptPage() {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>("all")
  const [creating, setCreating] = useState(false)
  const [approving, setApproving] = useState<Receipt | null>(null)
  const [certifying, setCertifying] = useState<Receipt | null>(null)
  const [matching, setMatching] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  const receipts = useQuery({
    queryKey: ["receipts", filter],
    queryFn: () => listReceipts(accessToken!, filter === "missing" ? { certificates: "missing" } : {}),
    enabled: Boolean(accessToken),
  })
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => listCustomers(accessToken!),
    enabled: Boolean(accessToken),
  })
  const customerName = useMemo(() => {
    const byId = new Map((customers.data ?? []).map((c) => [c.id, c.legalName]))
    return (id: string) => byId.get(id) ?? "Unknown customer"
  }, [customers.data])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["receipts"] })
    queryClient.invalidateQueries({ queryKey: ["customer-ageing"] })
    queryClient.invalidateQueries({ queryKey: ["customer-tie-out"] })
  }

  const create = useMutation({
    mutationFn: (input: ReceiptInput) => createReceipt(accessToken!, input),
    onSuccess: () => { setCreating(false); setError(null); refresh() },
    onError: (err) => setError(toMessage(err)),
  })

  const approve = useMutation({
    mutationFn: (id: string) => approveReceipt(accessToken!, id),
    onSuccess: () => { setApproving(null); refresh() },
    onError: (err) => { setApproving(null); setError(toMessage(err)) },
  })

  const certificates = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CertificatesInput }) => updateReceiptCertificates(accessToken!, id, input),
    onSuccess: () => { setCertifying(null); setError(null); refresh() },
    onError: (err) => setError(toMessage(err)),
  })

  const match = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { invoiceId?: string; openingBalanceId?: string; amount: string } }) =>
      matchCustomerAdvance(accessToken!, id, input),
    onSuccess: () => { setMatching(null); setError(null); refresh() },
    onError: (err) => setError(toMessage(err)),
  })

  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const rows: TableCell[][] = (receipts.data ?? []).map((r) => {
    const adv = advance(r)
    const missingVds = Number(r.vdsAmount) > 0 && !r.vdsCertificateRef
    const missingAit = Number(r.aitAmount) > 0 && !r.aitCertificateRef
    const actions = [
      ...(r.status === "DRAFT" && isSuperAdmin && r.createdBy !== user?.id
        ? [{ kind: "custom" as const, label: "Approve", icon: <RiCheckLine className="size-3.5" aria-hidden />, onClick: () => { setError(null); setApproving(r) } }]
        : []),
      ...(missingVds || missingAit
        ? [{ kind: "custom" as const, label: "Record certificate", icon: <RiFileTextLine className="size-3.5" aria-hidden />, onClick: () => { setError(null); setCertifying(r) } }]
        : []),
      ...(r.status === "APPROVED" && adv > 0
        ? [{ kind: "custom" as const, label: "Match advance", icon: <RiSwapLine className="size-3.5" aria-hidden />, onClick: () => { setError(null); setMatching(r) } }]
        : []),
    ]
    return [
      { text: formatDate(r.date) },
      { text: customerName(r.customer.id), weight: 600 },
      { text: r.reference ?? "—" },
      { text: formatMoney(r.amount, "BDT") },
      { text: Number(r.vdsAmount) > 0 ? formatMoney(r.vdsAmount, "BDT") : "—" },
      { text: Number(r.aitAmount) > 0 ? formatMoney(r.aitAmount, "BDT") : "—" },
      { text: formatMoney(settled(r).toFixed(2), "BDT") },
      { text: adv > 0 ? formatMoney(adv.toFixed(2), "BDT") : "—" },
      { node: <Badge variant={r.status === "APPROVED" ? "default" : "secondary"}>{r.status === "APPROVED" ? "Approved" : "Draft"}</Badge> },
      {
        node: (
          <div className="flex flex-wrap gap-1">
            {Number(r.vdsAmount) > 0 ? (missingVds ? <Tag label="VDS certificate missing" tone="yellow" /> : <span className="text-[11.5px]">VDS {r.vdsCertificateRef}</span>) : null}
            {Number(r.aitAmount) > 0 ? (missingAit ? <Tag label="AIT certificate missing" tone="yellow" /> : <span className="text-[11.5px]">AIT {r.aitCertificateRef}</span>) : null}
          </div>
        ),
      },
      { node: actions.length > 0 ? <RowActions actions={actions} /> : null },
    ]
  })

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Receipts"
        sub="Money received from customers, the tax they kept, and what it settles."
        cta="New receipt"
        onCta={() => { setError(null); setCreating(true) }}
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      {receipts.isSuccess ? (
        <div className="flex gap-1">
          {(["all", "missing"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                filter === f ? "bg-[#17191C] text-white" : "text-[#5F6B7C] hover:bg-[#F1F4F8]"
              }`}
            >
              {f === "all" ? "All" : "Certificate missing"}
            </button>
          ))}
        </div>
      ) : null}

      <PanelTable
        cols="0.8fr 1.1fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.7fr 1.2fr 0.9fr"
        headers={["Date", "Customer", "Reference", "Cash", "VAT withheld", "Tax withheld", "Settles", "Advance", "Status", "Certificates", ""]}
        rows={rows}
        isLoading={receipts.isPending}
        isError={receipts.isError}
        onRetry={() => receipts.refetch()}
        emptyTitle={filter === "missing" ? "Nothing is missing a certificate" : "No receipts yet"}
        emptyBody={filter === "missing" ? "Every withheld amount on record has its certificate." : "Record one when a customer pays."}
        emptyAction={filter === "missing" ? undefined : "New receipt"}
        onEmptyAction={() => { setError(null); setCreating(true) }}
      />

      {creating ? (
        <ReceiptDialog
          pending={create.isPending}
          error={error}
          onClose={() => setCreating(false)}
          onSave={(input) => create.mutate(input)}
        />
      ) : null}

      <Dialog open={approving !== null} onOpenChange={(open) => !open && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve this receipt?</DialogTitle>
            <DialogDescription>
              {approving ? `This posts ${formatMoney(approving.amount, "BDT")} received from ${customerName(approving.customer.id)}, clearing what it settles. It cannot be edited after approval.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogActions
              pending={approve.isPending}
              disabled={false}
              submitLabel="Approve and post"
              onCancel={() => setApproving(null)}
              onSubmit={() => approving && approve.mutate(approving.id)}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {certifying ? (
        <CertificateDialog
          receipt={certifying}
          pending={certificates.isPending}
          error={error}
          onClose={() => setCertifying(null)}
          onSave={(input) => certificates.mutate({ id: certifying.id, input })}
        />
      ) : null}

      {matching ? (
        <MatchAdvanceDialog
          receipt={matching}
          advanceLeft={advance(matching)}
          pending={match.isPending}
          error={error}
          onClose={() => setMatching(null)}
          onSave={(input) => match.mutate({ id: matching.id, input })}
        />
      ) : null}
    </div>
  )
}

function ReceiptDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: ReceiptInput) => void
}) {
  const { accessToken } = useSession()
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => listCustomers(accessToken!),
    enabled: Boolean(accessToken),
  })
  const [customerId, setCustomerId] = useState("")
  const [date, setDate] = useState(today())
  const [amount, setAmount] = useState("")
  const [reference, setReference] = useState("")
  const [taxOpen, setTaxOpen] = useState(false)
  const [vdsAmount, setVdsAmount] = useState("")
  const [vdsCertificateRef, setVdsCertificateRef] = useState("")
  const [vdsCertificateDate, setVdsCertificateDate] = useState("")
  const [aitAmount, setAitAmount] = useState("")
  const [aitCertificateRef, setAitCertificateRef] = useState("")
  const [aitCertificateDate, setAitCertificateDate] = useState("")
  const [allocated, setAllocated] = useState<Record<string, string>>({})

  const ageing = useQuery({
    queryKey: ["customer-ageing"],
    queryFn: () => getCustomerAgeing(accessToken!),
    enabled: Boolean(accessToken) && Boolean(customerId),
  })
  const rows: CustomerAgeingRow[] = (ageing.data ?? []).filter((r) => r.customerId === customerId)

  const settledTotal = (Number(amount) || 0) + (Number(vdsAmount) || 0) + (Number(aitAmount) || 0)
  const allocatedTotal = Object.values(allocated).reduce((s, v) => s + (Number(v) || 0), 0)

  const canSubmit = Boolean(customerId && date && Number(amount) > 0 && allocatedTotal <= settledTotal)

  const submit = () => {
    const allocations: Array<{ invoiceId: string; amount: string }> = []
    let openingAllocation: { amount: string } | undefined
    for (const [key, value] of Object.entries(allocated)) {
      if (!(Number(value) > 0)) continue
      const row = rows.find((r) => (r.invoiceId ?? r.openingBalanceId) === key)
      if (row?.invoiceId) allocations.push({ invoiceId: row.invoiceId, amount: value })
      else if (row?.openingBalanceId) openingAllocation = { amount: value }
    }
    onSave({
      customerId,
      date,
      amount,
      reference: reference.trim() || undefined,
      vdsAmount: vdsAmount || undefined,
      vdsCertificateRef: vdsCertificateRef.trim() || undefined,
      vdsCertificateDate: vdsCertificateDate || undefined,
      aitAmount: aitAmount || undefined,
      aitCertificateRef: aitCertificateRef.trim() || undefined,
      aitCertificateDate: aitCertificateDate || undefined,
      allocations,
      openingAllocation,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New receipt</DialogTitle>
          <DialogDescription>Cash received from a customer, and what it settles.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Customer" htmlFor="rcpt-customer">
              <select id="rcpt-customer" className={SELECT} value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAllocated({}) }}>
                <option value="">Choose a customer</option>
                {(customers.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.legalName}</option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor="rcpt-date">
              <Input id="rcpt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Cash received (BDT)" htmlFor="rcpt-amount">
              <Input id="rcpt-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Reference" htmlFor="rcpt-reference">
              <Input id="rcpt-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="TT-4471" />
            </Field>
          </div>

          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => setTaxOpen((v) => !v)}>
              {taxOpen ? "Hide" : "Add"} tax the customer kept
            </Button>
          </div>

          {taxOpen ? (
            <section className="grid grid-cols-1 gap-3 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-2">
              <Field label="VAT withheld (BDT)" htmlFor="rcpt-vds">
                <Input id="rcpt-vds" type="number" min={0} step="0.01" value={vdsAmount} onChange={(e) => setVdsAmount(e.target.value)} />
              </Field>
              <div />
              <Field label="VDS certificate number" htmlFor="rcpt-vds-ref" hint="Add the certificate now or later; the customer has three working days to issue a Mushak 6.6.">
                <Input id="rcpt-vds-ref" value={vdsCertificateRef} onChange={(e) => setVdsCertificateRef(e.target.value)} />
              </Field>
              <Field label="VDS certificate date" htmlFor="rcpt-vds-date">
                <Input id="rcpt-vds-date" type="date" value={vdsCertificateDate} onChange={(e) => setVdsCertificateDate(e.target.value)} />
              </Field>
              <Field label="Income tax withheld (BDT)" htmlFor="rcpt-ait">
                <Input id="rcpt-ait" type="number" min={0} step="0.01" value={aitAmount} onChange={(e) => setAitAmount(e.target.value)} />
              </Field>
              <div />
              <Field label="AIT certificate number" htmlFor="rcpt-ait-ref">
                <Input id="rcpt-ait-ref" value={aitCertificateRef} onChange={(e) => setAitCertificateRef(e.target.value)} />
              </Field>
              <Field label="AIT certificate date" htmlFor="rcpt-ait-date">
                <Input id="rcpt-ait-date" type="date" value={aitCertificateDate} onChange={(e) => setAitCertificateDate(e.target.value)} />
              </Field>
            </section>
          ) : null}

          {customerId ? (
            <section className="space-y-2">
              <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>What it settles</h3>
              {rows.length === 0 ? (
                <p className={`text-[12.5px] ${TONE.muted}`}>Nothing is outstanding for this customer.</p>
              ) : (
                rows.map((r) => {
                  const key = r.invoiceId ?? r.openingBalanceId ?? r.label
                  return (
                    <div key={key} className="grid grid-cols-1 gap-2 rounded-md border border-[#E4E9EF] p-3 sm:grid-cols-12">
                      <div className="sm:col-span-6">
                        <div className="text-[13px] font-semibold">{r.label}</div>
                        <div className={`text-[11.5px] ${TONE.muted}`}>Outstanding {formatMoney(r.outstanding, "BDT")}</div>
                      </div>
                      <Input
                        aria-label={`${r.label} amount`}
                        className="sm:col-span-3"
                        type="number"
                        min={0}
                        step="0.01"
                        value={allocated[key] ?? ""}
                        onChange={(e) => setAllocated((all) => ({ ...all, [key]: e.target.value }))}
                        placeholder="Amount"
                      />
                    </div>
                  )
                })
              )}
              <p className={`text-right text-[12.5px] ${TONE.muted}`}>
                Settles {formatMoney(allocatedTotal.toFixed(2), "BDT")} of {formatMoney(settledTotal.toFixed(2), "BDT")} (cash plus tax withheld).
                The rest, {formatMoney((settledTotal - allocatedTotal).toFixed(2), "BDT")}, is kept as an advance.
              </p>
            </section>
          ) : null}

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions pending={pending} disabled={!canSubmit} submitLabel="Save as draft" onCancel={onClose} onSubmit={submit} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CertificateDialog({
  receipt,
  pending,
  error,
  onClose,
  onSave,
}: {
  receipt: Receipt
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: CertificatesInput) => void
}) {
  const needsVds = Number(receipt.vdsAmount) > 0 && !receipt.vdsCertificateRef
  const needsAit = Number(receipt.aitAmount) > 0 && !receipt.aitCertificateRef
  const [vdsCertificateRef, setVdsCertificateRef] = useState("")
  const [vdsCertificateDate, setVdsCertificateDate] = useState("")
  const [aitCertificateRef, setAitCertificateRef] = useState("")
  const [aitCertificateDate, setAitCertificateDate] = useState("")

  const canSubmit =
    (!needsVds || Boolean(vdsCertificateRef.trim() && vdsCertificateDate)) &&
    (!needsAit || Boolean(aitCertificateRef.trim() && aitCertificateDate))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record the withholding certificate</DialogTitle>
          <DialogDescription>The Mushak 6.6 number and date, for the tax record.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {needsVds ? (
            <>
              <Field label="VDS certificate number" htmlFor="cert-vds-ref">
                <Input id="cert-vds-ref" value={vdsCertificateRef} onChange={(e) => setVdsCertificateRef(e.target.value)} />
              </Field>
              <Field label="VDS certificate date" htmlFor="cert-vds-date">
                <Input id="cert-vds-date" type="date" value={vdsCertificateDate} onChange={(e) => setVdsCertificateDate(e.target.value)} />
              </Field>
            </>
          ) : null}
          {needsAit ? (
            <>
              <Field label="AIT certificate number" htmlFor="cert-ait-ref">
                <Input id="cert-ait-ref" value={aitCertificateRef} onChange={(e) => setAitCertificateRef(e.target.value)} />
              </Field>
              <Field label="AIT certificate date" htmlFor="cert-ait-date">
                <Input id="cert-ait-date" type="date" value={aitCertificateDate} onChange={(e) => setAitCertificateDate(e.target.value)} />
              </Field>
            </>
          ) : null}
          {error ? <FormError>{error}</FormError> : null}
        </div>
        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={!canSubmit}
            submitLabel="Save"
            onCancel={onClose}
            onSubmit={() =>
              onSave({
                ...(needsVds ? { vdsCertificateRef: vdsCertificateRef.trim(), vdsCertificateDate } : {}),
                ...(needsAit ? { aitCertificateRef: aitCertificateRef.trim(), aitCertificateDate } : {}),
              })
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MatchAdvanceDialog({
  receipt,
  advanceLeft,
  pending,
  error,
  onClose,
  onSave,
}: {
  receipt: Receipt
  advanceLeft: number
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: { invoiceId?: string; openingBalanceId?: string; amount: string }) => void
}) {
  const { accessToken } = useSession()
  const ageing = useQuery({
    queryKey: ["customer-ageing"],
    queryFn: () => getCustomerAgeing(accessToken!),
    enabled: Boolean(accessToken),
  })
  const targets = (ageing.data ?? []).filter((r) => r.customerId === receipt.customer.id)
  const [targetKey, setTargetKey] = useState("")
  const [amount, setAmount] = useState("")

  const canSubmit = Boolean(targetKey && Number(amount) > 0 && Number(amount) <= advanceLeft)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Match the advance</DialogTitle>
          <DialogDescription>
            {formatMoney(advanceLeft.toFixed(2), "BDT")} is still unmatched on this receipt.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Apply to" htmlFor="match-target">
            <select id="match-target" className={SELECT} value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
              <option value="">Choose an invoice or the opening balance</option>
              {targets.map((r) => {
                const key = r.invoiceId ?? r.openingBalanceId ?? r.label
                return (
                  <option key={key} value={key}>{r.label} · {formatMoney(r.outstanding, "BDT")} outstanding</option>
                )
              })}
            </select>
          </Field>
          <Field label="Amount (BDT)" htmlFor="match-amount" hint={`Capped at ${formatMoney(advanceLeft.toFixed(2), "BDT")}, what is left of the advance.`}>
            <Input id="match-amount" type="number" min={0} max={advanceLeft} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {error ? <FormError>{error}</FormError> : null}
        </div>
        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={!canSubmit}
            submitLabel="Match"
            onCancel={onClose}
            onSubmit={() => {
              const row = targets.find((r) => (r.invoiceId ?? r.openingBalanceId ?? r.label) === targetKey)
              if (!row) return
              onSave(row.invoiceId ? { invoiceId: row.invoiceId, amount } : { openingBalanceId: row.openingBalanceId!, amount })
            }}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
