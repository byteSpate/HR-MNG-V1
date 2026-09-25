"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { RiAddLine, RiArrowGoBackLine, RiFileTextLine } from "@remixicon/react"

import { reverseReceipt } from "@/lib/api/receipt"
import { useSession } from "@/lib/auth/session-context"
import type { DealMoneyInvoice, Receipt } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { CertificateDialog } from "@/components/money/certificate-dialog"
import { invoiceStillOwed, ReceiptDialog } from "@/components/money/receipt-dialog"
import { DialogActions, Field, FormError, PanelAlert, RowActions, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/**
 * The Paid part of the Money section: every receipt against this deal, with
 * withheld tax and its certificate, and (only for Finance, `canEdit`) the
 * button to record one. Receipts have no draft or approval step (design
 * doc, "The documents": "Saved = counted") — a receipt is either approved or
 * reversed, so there is no "Waiting for approval" state to show here.
 */
export function PaidPart({
  opportunityId,
  receipts,
  invoices,
  canEdit,
  invalidate,
}: {
  opportunityId: string
  receipts: Receipt[]
  invoices: DealMoneyInvoice[]
  canEdit: boolean
  invalidate: () => void
}) {
  const { accessToken, user } = useSession()
  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const [recording, setRecording] = useState(false)
  const [certifying, setCertifying] = useState<Receipt | null>(null)
  const [reversing, setReversing] = useState<Receipt | null>(null)
  const [reverseReason, setReverseReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const reverse = useMutation({
    mutationFn: () => reverseReceipt(accessToken!, reversing!.id, reverseReason.trim()),
    onSuccess: () => {
      setReversing(null)
      setReverseReason("")
      setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  // A control that cannot do anything is a bug: "Record payment received"
  // is hidden, not shown with an always-empty picker, when no approved
  // invoice on this deal has money still owed. Same rule as "Pay supplier"
  // in `BoughtPart`.
  const canRecord = invoices.some((inv) => inv.status === "APPROVED" && invoiceStillOwed(inv) > 0.004)

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-[15px] font-bold tracking-tight">Paid</h2>
        {canEdit && canRecord ? (
          <Button
            type="button"
            onClick={() => { setError(null); setRecording(true) }}
            className="h-8 gap-1 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
          >
            <RiAddLine className="size-3.5" aria-hidden />
            Record payment received
          </Button>
        ) : null}
      </div>

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      {receipts.length === 0 ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
          <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>No payments recorded yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {receipts.map((r) => {
            const reversed = r.reversedAt !== null
            const missingVds = Number(r.vdsAmount) > 0 && !r.vdsCertificateRef
            const missingAit = Number(r.aitAmount) > 0 && !r.aitCertificateRef
            const actions = [
              ...(canEdit && !reversed && (missingVds || missingAit)
                ? [{ kind: "custom" as const, label: "Add certificate", icon: <RiFileTextLine className="size-3.5" aria-hidden />, onClick: () => { setError(null); setCertifying(r) } }]
                : []),
              ...(canEdit && !reversed && isSuperAdmin
                ? [{ kind: "custom" as const, label: "Reverse", icon: <RiArrowGoBackLine className="size-3.5" aria-hidden />, onClick: () => { setError(null); setReversing(r); setReverseReason("") } }]
                : []),
            ]

            return (
              <li key={r.id} className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className={`min-w-0 ${reversed ? "line-through opacity-60" : ""}`}>
                    <div className="text-[13.5px] font-bold">{formatMoney(r.amount, "BDT")}</div>
                    <div className={`mt-0.5 text-[12px] ${TONE.muted}`}>
                      {formatDate(r.date)}
                      {r.reference ? ` · ${r.reference}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {actions.length > 0 ? <RowActions actions={actions} /> : null}
                  </div>
                </div>

                {reversed ? (
                  <p className={`mt-2 text-[12px] ${TONE.danger}`}>Reversed: {r.reversalReason}</p>
                ) : null}

                {Number(r.vdsAmount) > 0 || Number(r.aitAmount) > 0 ? (
                  <div className={`mt-2.5 flex flex-wrap items-center gap-3 border-t border-[#EEF1F5] pt-2.5 text-[12px] ${reversed ? "line-through opacity-60" : ""}`}>
                    {Number(r.vdsAmount) > 0 ? (
                      <span>
                        VAT withheld {formatMoney(r.vdsAmount, "BDT")}
                        {" "}
                        {missingVds && !reversed ? <Tag label="Certificate missing" tone="yellow" /> : r.vdsCertificateRef ? <span className={TONE.muted}>· {r.vdsCertificateRef}</span> : null}
                      </span>
                    ) : null}
                    {Number(r.aitAmount) > 0 ? (
                      <span>
                        Income tax withheld {formatMoney(r.aitAmount, "BDT")}
                        {" "}
                        {missingAit && !reversed ? <Tag label="Certificate missing" tone="yellow" /> : r.aitCertificateRef ? <span className={TONE.muted}>· {r.aitCertificateRef}</span> : null}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {recording ? (
        <ReceiptDialog
          open
          onOpenChange={(open) => !open && setRecording(false)}
          opportunityId={opportunityId}
          invoices={invoices}
          onSaved={() => {
            setRecording(false)
            invalidate()
          }}
        />
      ) : null}

      {certifying ? (
        <CertificateDialog
          open
          onOpenChange={(open) => !open && setCertifying(null)}
          receipt={certifying}
          onSaved={() => {
            setCertifying(null)
            invalidate()
          }}
        />
      ) : null}

      <Dialog open={reversing !== null} onOpenChange={(open) => !open && setReversing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse this payment?</DialogTitle>
            <DialogDescription>
              {reversing ? `This undoes ${formatMoney(reversing.amount, "BDT")} received on ${formatDate(reversing.date)}. Say why.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Reason" htmlFor="rcpt-reverse-reason">
              <Textarea
                id="rcpt-reverse-reason"
                rows={2}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Why this payment is being reversed"
              />
            </Field>
            {error ? <FormError>{error}</FormError> : null}
          </div>
          <DialogFooter>
            <DialogActions
              pending={reverse.isPending}
              disabled={!reverseReason.trim()}
              submitLabel="Reverse"
              onCancel={() => setReversing(null)}
              onSubmit={() => reverse.mutate()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
