"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiCheckLine } from "@remixicon/react"

import { listCustomerPos } from "@/lib/api/customerPo"
import { approveEarningEvent, listEarningEvents } from "@/lib/api/earningEvent"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, EarningEvent, ReceivableDocStatus } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { EarningEventDialog } from "@/components/accounting/earning-event-dialog"
import { PageHeader } from "@/components/dashboard/page-header"
import { ConfirmDialog, DialogActions, Field, PanelAlert, PanelTable, RowActions, toMessage } from "@/components/dashboard/record-kit"
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

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const KIND_LABEL: Record<EarningEvent["kind"], string> = { DELIVERY: "Delivery", ACCEPTANCE: "Acceptance" }

function eventNet(e: EarningEvent): string {
  return e.lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2)
}

/** A tracked OPEN PO with at least one DELIVERY or ACCEPTANCE line — a
 *  MONTHLY line earns through the monthly run, never recorded here. */
function isRecordable(po: CustomerPo): boolean {
  return po.trackDelivery && po.status === "OPEN" && po.lines.some((l) => l.earnKind === "DELIVERY" || l.earnKind === "ACCEPTANCE")
}

const FILTERS: Array<{ label: string; value: ReceivableDocStatus | "" }> = [
  { label: "Draft", value: "DRAFT" },
  { label: "Approved", value: "APPROVED" },
  { label: "All", value: "" },
]

export function EarningEventPage() {
  const { accessToken, user } = useSession()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ReceivableDocStatus | "">("DRAFT")
  const [picking, setPicking] = useState(false)
  const [recording, setRecording] = useState<{ po: CustomerPo; kind: "DELIVERY" | "ACCEPTANCE" } | null>(null)
  const [approving, setApproving] = useState<EarningEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const events = useQuery({
    queryKey: ["earning-events", { status }],
    queryFn: () => listEarningEvents(accessToken!, status ? { status } : {}),
    enabled: Boolean(accessToken),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["earning-events"] })
    queryClient.invalidateQueries({ queryKey: ["customer-pos"] })
  }

  const approve = useMutation({
    mutationFn: (id: string) => approveEarningEvent(accessToken!, id),
    onSuccess: () => {
      setApproving(null)
      setError(null)
      refresh()
    },
    onError: (err) => {
      setApproving(null)
      setError(toMessage(err))
    },
  })

  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const rows: TableCell[][] = (events.data ?? []).map((e) => {
    const canApprove = e.status === "DRAFT" && isSuperAdmin && e.createdBy !== user?.id
    const actions = canApprove
      ? [{ kind: "custom" as const, label: "Approve", icon: <RiCheckLine className="size-3.5" aria-hidden />, onClick: () => { setError(null); setApproving(e) } }]
      : []
    return [
      { text: formatDate(e.date) },
      { text: KIND_LABEL[e.kind] },
      { text: e.evidenceRef },
      { text: e.po.serial },
      { text: e.po.customer.legalName },
      { text: e.po.opportunity.serial },
      { text: formatMoney(eventNet(e), "BDT") },
      { node: <Badge variant={e.status === "APPROVED" ? "default" : "secondary"}>{e.status === "APPROVED" ? "Approved" : "Draft"}</Badge> },
      { node: actions.length > 0 ? <RowActions actions={actions} /> : null },
    ]
  })

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Deliveries & acceptances"
        sub="When goods reached the customer or the customer signed work off. Approving one earns its revenue."
        cta="New"
        onCta={() => { setError(null); setPicking(true) }}
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      {events.isSuccess ? (
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
        cols="0.9fr 0.9fr 1fr 0.9fr 1.1fr 0.8fr 0.9fr 0.9fr 0.8fr"
        headers={["Date", "Kind", "Reference", "PO", "Customer", "Deal", "Earned", "Status", ""]}
        rows={rows}
        isLoading={events.isPending}
        isError={events.isError}
        onRetry={() => events.refetch()}
        emptyTitle={status ? "Nothing with this status" : "No deliveries or acceptances recorded yet"}
        emptyBody={
          status
            ? "Nothing with this status."
            : "Record one when goods reach the customer or the customer signs work off, on a PO that tracks delivery."
        }
        emptyAction={status ? undefined : "New"}
        onEmptyAction={() => { setError(null); setPicking(true) }}
      />

      {picking ? (
        <PoPickerDialog
          onClose={() => setPicking(false)}
          onPicked={(po, kind) => {
            setPicking(false)
            setRecording({ po, kind })
          }}
        />
      ) : null}

      {recording ? (
        <EarningEventDialog
          po={recording.po}
          kind={recording.kind}
          open
          onOpenChange={(open) => !open && setRecording(null)}
          onSaved={() => {
            setRecording(null)
            refresh()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={approving !== null}
        title={approving ? `Approve ${KIND_LABEL[approving.kind].toLowerCase()} ${approving.evidenceRef}?` : ""}
        body={
          approving
            ? `Approving earns ${formatMoney(eventNet(approving), "BDT")} of revenue on ${approving.po.opportunity.name}, dated ${formatDate(approving.date)}, and releases the matching share of the goods' cost.`
            : ""
        }
        confirmLabel="Approve"
        pending={approve.isPending}
        onCancel={() => setApproving(null)}
        onConfirm={() => approving && approve.mutate(approving.id)}
      />
    </div>
  )
}

function PoPickerDialog({
  onClose,
  onPicked,
}: {
  onClose: () => void
  onPicked: (po: CustomerPo, kind: "DELIVERY" | "ACCEPTANCE") => void
}) {
  const { accessToken } = useSession()
  const [poId, setPoId] = useState("")
  const [kind, setKind] = useState<"DELIVERY" | "ACCEPTANCE" | "">("")

  const openPos = useQuery({
    queryKey: ["customer-pos", { status: "OPEN" }],
    queryFn: () => listCustomerPos(accessToken!, { status: "OPEN" }),
    enabled: Boolean(accessToken),
  })

  const pos = (openPos.data ?? []).filter(isRecordable)
  const selected = pos.find((p) => p.id === poId) ?? null
  const kinds: Array<"DELIVERY" | "ACCEPTANCE"> = selected
    ? (["DELIVERY", "ACCEPTANCE"] as const).filter((k) => selected.lines.some((l) => l.earnKind === k))
    : []

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New delivery or acceptance</DialogTitle>
          <DialogDescription>Choose the PO, then whether this is a delivery or an acceptance.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {openPos.isSuccess && pos.length === 0 ? (
            <PanelAlert>No open PO tracks delivery with something left to deliver or accept.</PanelAlert>
          ) : null}
          <Field label="Customer PO" htmlFor="ee-pick-po">
            <select
              id="ee-pick-po"
              className={SELECT}
              value={poId}
              onChange={(e) => { setPoId(e.target.value); setKind("") }}
            >
              <option value="">Choose a tracked open PO</option>
              {pos.map((p) => (
                <option key={p.id} value={p.id}>{p.serial} · {p.customer.legalName} · {p.customerPoNumber}</option>
              ))}
            </select>
          </Field>
          {selected ? (
            <Field label="Kind" htmlFor="ee-pick-kind">
              <select
                id="ee-pick-kind"
                className={SELECT}
                value={kind}
                onChange={(e) => setKind(e.target.value as "DELIVERY" | "ACCEPTANCE")}
              >
                <option value="">Choose delivery or acceptance</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={false}
            disabled={!selected || !kind}
            submitLabel="Continue"
            onCancel={onClose}
            onSubmit={() => selected && kind && onPicked(selected, kind)}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
