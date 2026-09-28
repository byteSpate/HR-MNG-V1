"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { RiAddLine } from "@remixicon/react"

import { cancelCustomerPo } from "@/lib/api/customerPo"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, CustomerPoStatus } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { CustomerPoDialog } from "@/components/money/customer-po-dialog"
import { DialogActions, Field, FormError, PanelAlert, RowActions, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { Tone } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function poNet(po: CustomerPo): string {
  return po.lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2)
}

function lineInvoiced(line: CustomerPo["lines"][number]): string {
  return line.invoiceLines.reduce((s, il) => s + Number(il.amount), 0).toFixed(2)
}

const STATUS_TONE: Record<CustomerPoStatus, Tone> = { OPEN: "neutral", COMPLETE: "green", CANCELLED: "red" }
const STATUS_LABEL: Record<CustomerPoStatus, string> = { OPEN: "Open", COMPLETE: "Complete", CANCELLED: "Cancelled" }

/**
 * A PO can still be edited or cancelled only while nothing has been invoiced
 * against any of its lines — the same rule the server enforces on
 * `PATCH /api/customer-pos/:id` and its `/cancel`, mirrored here only to
 * decide which buttons to show, not to re-implement the check.
 */
function canChange(po: CustomerPo): boolean {
  return po.status === "OPEN" && po.lines.every((l) => l.invoiceLines.length === 0)
}

/**
 * The Customer PO part of the Money section. "Record PO" is always offered —
 * a deal can have more than one PO — and needs no role check here: anyone
 * who can load this deal's Money section already satisfies the server's
 * `requireFinanceOrSales` on the PO write routes (both read the same
 * Finance-or-assigned-sales-user rule — `receivables.access.ts`'s
 * `assertDealAccess` and `customerPo.routes.ts`'s own check), so a separate
 * `canEdit` prop here would only ever agree with "the page loaded at all".
 */
export function PoPart({
  opportunityId,
  pos,
  invalidate,
}: {
  opportunityId: string
  pos: CustomerPo[]
  /** Runs after any write below lands, so the Money section and the wider
   *  app (Deals list, Waiting-for-approval queue) pick up the change. */
  invalidate: () => void
}) {
  const { accessToken } = useSession()
  const [recording, setRecording] = useState(false)
  const [editing, setEditing] = useState<CustomerPo | null>(null)
  const [cancelling, setCancelling] = useState<CustomerPo | null>(null)
  const [cancelReason, setCancelReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const cancel = useMutation({
    mutationFn: () => cancelCustomerPo(accessToken!, cancelling!.id, cancelReason.trim()),
    onSuccess: () => {
      setCancelling(null)
      setCancelReason("")
      setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-[15px] font-bold tracking-tight">Customer PO</h2>
        <Button
          type="button"
          onClick={() => {
            setError(null)
            setRecording(true)
          }}
          className="h-8 gap-1 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
        >
          <RiAddLine className="size-3.5" aria-hidden />
          Record PO
        </Button>
      </div>

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      {pos.length === 0 ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
          <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>
            No PO yet. Record the customer&apos;s PO when it arrives.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pos.map((po) => (
            <li key={po.id} className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-bold">{po.serial}</span>
                    <Tag label={STATUS_LABEL[po.status]} tone={STATUS_TONE[po.status]} />
                  </div>
                  <div className={`mt-0.5 text-[12px] ${TONE.muted}`}>
                    {po.customerPoNumber} · {formatDate(po.date)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="mr-2 text-[13px] font-bold">{formatMoney(poNet(po), "BDT")}</span>
                  {canChange(po) ? (
                    <RowActions
                      actions={[
                        {
                          kind: "edit",
                          label: "Edit",
                          onClick: () => {
                            setError(null)
                            setEditing(po)
                          },
                        },
                        {
                          kind: "delete",
                          label: "Cancel",
                          onClick: () => {
                            setError(null)
                            setCancelling(po)
                            setCancelReason("")
                          },
                        },
                      ]}
                    />
                  ) : null}
                </div>
              </div>

              {po.cancelReason ? <p className={`mt-2 text-[12px] ${TONE.danger}`}>Cancelled: {po.cancelReason}</p> : null}

              <div className="mt-3 space-y-1.5 border-t border-[#EEF1F5] pt-3">
                {po.lines.map((line) => (
                  <div key={line.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate">{line.description}</span>
                    <span className={`shrink-0 ${TONE.muted}`}>
                      {formatMoney(lineInvoiced(line), "BDT")} of {formatMoney(line.amount, "BDT")} invoiced
                    </span>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {recording ? (
        <CustomerPoDialog
          open
          onOpenChange={(open) => !open && setRecording(false)}
          opportunityId={opportunityId}
          onSaved={() => {
            setRecording(false)
            invalidate()
          }}
        />
      ) : null}

      {editing ? (
        <CustomerPoDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          opportunityId={opportunityId}
          po={editing}
          onSaved={() => {
            setEditing(null)
            invalidate()
          }}
        />
      ) : null}

      <Dialog open={cancelling !== null} onOpenChange={(open) => !open && setCancelling(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {cancelling?.serial}?</DialogTitle>
            <DialogDescription>Only a PO with no invoice yet can be cancelled. Say why.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Reason" htmlFor="po-cancel-reason">
              <Textarea
                id="po-cancel-reason"
                rows={2}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Customer withdrew the order"
              />
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
    </section>
  )
}
