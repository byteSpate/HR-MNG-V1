"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiFileList2Line } from "@remixicon/react"

import { cancelCustomerPo, listCustomerPos } from "@/lib/api/customerPo"
import { useSession } from "@/lib/auth/session-context"
import { ROLE_ROUTES } from "@/lib/auth/role-routes"
import type { CustomerPo, CustomerPoStatus } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import { CustomerPoDialog } from "@/components/accounting/customer-po-dialog"
import {
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  PanelTable,
  RowActions,
  toMessage,
} from "@/components/dashboard/record-kit"
import type { TableCell, Tone } from "@/components/dashboard/types"
import { Tag } from "@/components/dashboard/tag"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function poNet(po: CustomerPo): string {
  return po.lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2)
}

function poInvoiced(po: CustomerPo): number {
  return po.lines.reduce((s, l) => s + l.invoiceLines.reduce((a, il) => a + Number(il.amount), 0), 0)
}

/** Approved event lines plus posted monthly earnings, per spec §3 — only
 *  meaningful on a tracked PO; an untracked PO earns on invoicing alone. */
function poEarned(po: CustomerPo): number {
  return po.lines.reduce(
    (s, l) => s + l.earningLines.reduce((a, el) => a + Number(el.amount), 0) + l.monthlyEarnings.reduce((a, me) => a + Number(me.amount), 0),
    0
  )
}

/** Beside Invoiced: `—` for an untracked PO (its earned figure is the
 *  invoiced one, so showing it twice invites "why two?"); otherwise the
 *  earned amount, with a tag only when it differs from what is invoiced. */
function earnedCell(po: CustomerPo): TableCell {
  if (!po.trackDelivery) return { text: "—" }
  const earned = poEarned(po)
  const diff = earned - poInvoiced(po)
  return {
    node: (
      <div className="min-w-0">
        <div className="text-[13px]" style={{ color: "#1C2733" }}>{formatMoney(earned.toFixed(2), "BDT")}</div>
        {diff !== 0 ? (
          <div className="mt-0.5">
            <Tag
              label={diff > 0 ? `Unbilled ${formatMoney(diff.toFixed(2), "BDT")}` : `Unearned ${formatMoney((-diff).toFixed(2), "BDT")}`}
              tone={diff > 0 ? "green" : "yellow"}
            />
          </div>
        ) : null}
      </div>
    ),
  }
}

// No "blue" tone exists in this design system (Tone is green/yellow/red/neutral).
const STATUS_TONE: Record<CustomerPoStatus, Tone> = { OPEN: "neutral", COMPLETE: "green", CANCELLED: "red" }
const STATUS_LABEL: Record<CustomerPoStatus, string> = { OPEN: "Open", COMPLETE: "Complete", CANCELLED: "Cancelled" }

const FILTERS: Array<{ label: string; value: CustomerPoStatus | "" }> = [
  { label: "Open", value: "OPEN" },
  { label: "Complete", value: "COMPLETE" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "All", value: "" },
]

export function CustomerPoPage() {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<CustomerPoStatus | "">("OPEN")
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CustomerPo | null>(null)
  const [cancelling, setCancelling] = useState<CustomerPo | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const pos = useQuery({
    queryKey: ["customer-pos", status],
    queryFn: () => listCustomerPos(accessToken!, status ? { status } : {}),
    enabled: Boolean(accessToken),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customer-pos"] })

  const cancel = useMutation({
    mutationFn: () => cancelCustomerPo(accessToken!, cancelling!.id, cancelReason.trim()),
    onSuccess: () => {
      setCancelling(null)
      setCancelReason("")
      setError(null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const basePath = user ? ROLE_ROUTES[user.role] : ""
  const canEditOrCancel = (po: CustomerPo) => po.status === "OPEN" && po.lines.every((l) => l.invoiceLines.length === 0)

  const rows: TableCell[][] = (pos.data ?? []).map((po) => {
    const actions = [
      ...(canEditOrCancel(po) ? [{ kind: "edit" as const, label: "Edit", onClick: () => { setError(null); setEditing(po) } }] : []),
      ...(canEditOrCancel(po) ? [{ kind: "delete" as const, label: "Cancel", onClick: () => { setError(null); setCancelling(po); setCancelReason("") } }] : []),
      ...(po.status === "OPEN"
        ? [{ kind: "link" as const, label: "Invoice", href: `${basePath}/accounting/invoices?po=${po.id}`, icon: <RiFileList2Line className="size-3.5" aria-hidden /> }]
        : []),
    ]
    return [
      { text: po.serial, sub: po.customerPoNumber, weight: 600 },
      { text: po.customer.legalName },
      { text: po.opportunity.serial },
      { text: formatDate(po.date) },
      { text: formatMoney(poNet(po), "BDT") },
      { text: po.status === "CANCELLED" ? "—" : formatMoney(poInvoiced(po).toFixed(2), "BDT") },
      po.status === "CANCELLED" ? { text: "—" } : earnedCell(po),
      { node: <Tag label={STATUS_LABEL[po.status]} tone={STATUS_TONE[po.status]} /> },
      { node: actions.length > 0 ? <RowActions actions={actions} /> : null },
    ]
  })

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Customer POs"
        sub="What each customer ordered on a Won deal, and what is left to invoice on it."
        cta="New customer PO"
        onCta={() => { setError(null); setCreating(true) }}
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      {pos.isSuccess ? (
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                status === f.value ? "bg-[#17191C] text-white" : "text-[#5F6B7C] hover:bg-[#F1F4F8]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      <PanelTable
        cols="1.2fr 1.1fr 0.8fr 0.8fr 0.9fr 0.9fr 1fr 0.8fr 1fr"
        headers={["PO", "Customer", "Deal", "Date", "Net", "Invoiced", "Earned", "Status", ""]}
        rows={rows}
        isLoading={pos.isPending}
        isError={pos.isError}
        onRetry={() => pos.refetch()}
        emptyTitle={status ? "No POs with this status" : "No customer POs yet"}
        emptyBody={
          status
            ? "No POs with this status."
            : "Record one when a customer sends a purchase order for a Won deal."
        }
        emptyAction={status ? undefined : "New customer PO"}
        onEmptyAction={() => { setError(null); setCreating(true) }}
      />

      {creating ? (
        <CustomerPoDialog
          open
          onOpenChange={(open) => !open && setCreating(false)}
          opportunity={null}
          onSaved={() => { setCreating(false); refresh() }}
        />
      ) : null}

      {editing ? (
        <CustomerPoDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          opportunity={null}
          po={editing}
          onSaved={() => { setEditing(null); refresh() }}
        />
      ) : null}

      <Dialog open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {cancelling?.serial}?</DialogTitle>
            <DialogDescription>Only an uninvoiced PO can be cancelled. Give a reason for the record.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Reason" htmlFor="po-cancel-reason">
              <Textarea id="po-cancel-reason" rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Customer withdrew the order" />
            </Field>
            {error ? <FormError>{error}</FormError> : null}
          </div>
          <DialogFooter>
            <DialogActions
              pending={cancel.isPending}
              disabled={!cancelReason.trim()}
              submitLabel="Cancel PO"
              onCancel={() => setCancelling(null)}
              onSubmit={() => cancel.mutate()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
