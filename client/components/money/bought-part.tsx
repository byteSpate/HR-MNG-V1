"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { RiAddLine, RiArrowGoBackLine, RiCheckLine, RiFileEditLine } from "@remixicon/react"

import { approveSupplierBill } from "@/lib/api/supplierBill"
import { approveSupplierCreditNote } from "@/lib/api/supplierCreditNote"
import { reverseSupplierPayment } from "@/lib/api/supplierPayment"
import { sendBackApproval } from "@/lib/api/dealMoney"
import { useSession } from "@/lib/auth/session-context"
import type { DealMoneyProductLine, DealMoneySupplierBill, SupplierCreditNote, SupplierPayment } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { MoneyHighlight } from "@/components/money/money-section"
import { BillCreditNoteDialog } from "@/components/money/bill-credit-note-dialog"
import { BillDialog } from "@/components/money/bill-dialog"
import { billStillOwed, PaymentDialog } from "@/components/money/payment-dialog"
import {
  ConfirmDialog,
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  PanelNotice,
  RowActions,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { Tone } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function billTotals(bill: DealMoneySupplierBill): { net: number; vat: number; total: number } {
  const net = bill.lines.reduce((s, l) => s + Number(l.amount), 0)
  const vat = bill.lines.reduce((s, l) => s + Number(l.vatAmount), 0)
  return { net, vat, total: net + vat }
}

/** Same worked example as `InvoicedPart`'s `invoiceStatus`: a never-sent-back
 *  DRAFT bill reads "Waiting for approval", not a separate unfinished-draft
 *  state (design doc's own worked example). A bill is never REVERSED, so
 *  that status value never reaches here. */
function billStatus(bill: DealMoneySupplierBill): { label: string; tone: Tone } {
  if (bill.status === "APPROVED") return { label: "Approved", tone: "green" }
  if (bill.sentBackAt) return { label: "Sent back", tone: "yellow" }
  return { label: "Waiting for approval", tone: "neutral" }
}

function creditNoteStatus(note: SupplierCreditNote): { label: string; tone: Tone } {
  return note.status === "APPROVED" ? { label: "Approved", tone: "green" } : { label: "Waiting for approval", tone: "neutral" }
}

/**
 * The Bought part of the Money section: this deal's supplier bills, their
 * nested credit notes, and supplier payments, plus (only for Finance,
 * `canEdit`) the buttons to add, edit, approve, send back, fix or pay one.
 *
 * Shown only when `canSeeCost` — checked by the parent (`MoneySection`), not
 * here, so this component never mounts for a viewer who cannot see cost,
 * matching `bills`/`supplierPayments` being `null` on the payload for them.
 */
export function BoughtPart({
  opportunityId,
  bills,
  supplierPayments,
  productLines,
  canEdit,
  invalidate,
  highlight,
}: {
  opportunityId: string
  bills: DealMoneySupplierBill[]
  supplierPayments: SupplierPayment[]
  productLines: DealMoneyProductLine[]
  canEdit: boolean
  invalidate: () => void
  highlight?: MoneyHighlight | null
}) {
  const { accessToken, user } = useSession()
  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const [addingBill, setAddingBill] = useState(false)
  const [editingBill, setEditingBill] = useState<DealMoneySupplierBill | null>(null)
  const [fixingBill, setFixingBill] = useState<DealMoneySupplierBill | null>(null)
  const [approvingBill, setApprovingBill] = useState<DealMoneySupplierBill | null>(null)
  const [sendingBackBill, setSendingBackBill] = useState<DealMoneySupplierBill | null>(null)
  const [sendBackNote, setSendBackNote] = useState("")
  const [approvingCn, setApprovingCn] = useState<SupplierCreditNote | null>(null)
  const [paying, setPaying] = useState(false)
  const [reversingPayment, setReversingPayment] = useState<SupplierPayment | null>(null)
  const [reverseReason, setReverseReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const approve = useMutation({
    mutationFn: (id: string) => approveSupplierBill(accessToken!, id),
    onSuccess: () => {
      setApprovingBill(null)
      setError(null)
      invalidate()
    },
    onError: (err) => {
      setApprovingBill(null)
      setError(toMessage(err))
    },
  })

  const sendBack = useMutation({
    mutationFn: () => sendBackApproval(accessToken!, "SUPPLIER_BILL", sendingBackBill!.id, sendBackNote.trim()),
    onSuccess: () => {
      setSendingBackBill(null)
      setSendBackNote("")
      setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const approveCn = useMutation({
    mutationFn: (id: string) => approveSupplierCreditNote(accessToken!, id),
    onSuccess: () => {
      setApprovingCn(null)
      setError(null)
      invalidate()
    },
    onError: (err) => {
      setApprovingCn(null)
      setError(toMessage(err))
    },
  })

  const reversePayment = useMutation({
    mutationFn: () => reverseSupplierPayment(accessToken!, reversingPayment!.id, reverseReason.trim()),
    onSuccess: () => {
      setReversingPayment(null)
      setReverseReason("")
      setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  // Scroll a highlighted bill or nested credit note into view and flash it —
  // the identical, deliberately small pattern `InvoicedPart` uses for
  // invoices and customer credit notes (Task 20).
  const rowRefs = useRef<Record<string, HTMLElement | null>>({})
  const [flashId, setFlashId] = useState<string | null>(null)
  const highlightedId =
    highlight?.kind === "SUPPLIER_BILL" || highlight?.kind === "SUPPLIER_CREDIT_NOTE" ? highlight.id : null

  useEffect(() => {
    if (!highlightedId) return
    const el = rowRefs.current[highlightedId]
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    setFlashId(highlightedId)
    const timer = setTimeout(() => setFlashId(null), 2200)
    return () => clearTimeout(timer)
  }, [highlightedId])

  /** A payment's allocation only carries `bill.billNumber` reliably on this
   *  payload (`DEAL_PAYMENT_INCLUDE`) — this deal's own bill list is a safe
   *  fallback for the same figure. */
  const billNumberOf = (id: string) => bills.find((b) => b.id === id)?.billNumber ?? "a bill"

  /** Every payment's `supplierId` always matches a bill on this deal — a
   *  payment can only be created against a supplier already offered by
   *  `PaymentDialog`'s picker, which is itself built from `bills`. The
   *  fallback only guards a payload that somehow disagrees with that. */
  const supplierNameOf = (id: string) => bills.find((b) => b.supplierId === id)?.supplier.name ?? "Unknown supplier"

  // A control that cannot do anything is a bug: "Pay supplier" is hidden,
  // not shown with an always-empty picker, when nothing on this deal is
  // actually payable (an approved bill with money still owed).
  const canPay = bills.some((b) => b.status === "APPROVED" && billStillOwed(b) > 0.004)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-[15px] font-bold tracking-tight">Bought</h2>
        {canEdit ? (
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              onClick={() => { setError(null); setAddingBill(true) }}
              className="h-8 gap-1 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
            >
              <RiAddLine className="size-3.5" aria-hidden />
              Add supplier bill
            </Button>
            {canPay ? (
              <Button
                type="button"
                onClick={() => { setError(null); setPaying(true) }}
                className="h-8 gap-1 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
              >
                <RiAddLine className="size-3.5" aria-hidden />
                Pay supplier
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      {bills.length === 0 ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
          <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>No supplier bills yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {bills.map((bill) => {
            const { total } = billTotals(bill)
            const status = billStatus(bill)
            // Approve and Send back, together. Hidden from whoever created
            // or last saved the draft (the server refuses both of them), and
            // on a draft already sent back and not saved again (the server
            // refuses to approve it until its preparer saves it).
            const canApprove =
              canEdit &&
              bill.status === "DRAFT" &&
              isSuperAdmin &&
              bill.createdBy !== user?.id &&
              bill.updatedBy !== user?.id &&
              !bill.sentBackAt
            const actions = [
              ...(canEdit && bill.status === "DRAFT"
                ? [{ kind: "edit" as const, label: "Edit", onClick: () => { setError(null); setEditingBill(bill) } }]
                : []),
              ...(canApprove
                ? [
                    {
                      kind: "custom" as const,
                      label: "Approve",
                      icon: <RiCheckLine className="size-3.5" aria-hidden />,
                      onClick: () => { setError(null); setApprovingBill(bill) },
                    },
                    {
                      kind: "custom" as const,
                      label: "Send back",
                      icon: <RiArrowGoBackLine className="size-3.5" aria-hidden />,
                      onClick: () => { setError(null); setSendingBackBill(bill); setSendBackNote("") },
                    },
                  ]
                : []),
              ...(canEdit && bill.status === "APPROVED"
                ? [
                    {
                      kind: "custom" as const,
                      label: "Fix this bill",
                      icon: <RiFileEditLine className="size-3.5" aria-hidden />,
                      onClick: () => { setError(null); setFixingBill(bill) },
                    },
                  ]
                : []),
            ]

            return (
              <li
                key={bill.id}
                ref={(el) => {
                  rowRefs.current[bill.id] = el
                }}
                className={cn(
                  "rounded-md border bg-white px-4 py-4 transition-colors sm:px-5.5 sm:py-5",
                  flashId === bill.id ? "border-[#E7C46B] bg-[#FFFBEF]" : "border-[#E4E9EF]"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-bold">{bill.supplier.name}</span>
                      <Tag label={status.label} tone={status.tone} />
                    </div>
                    <div className={`mt-0.5 text-[12px] ${TONE.muted}`}>
                      {bill.billNumber} · {formatDate(bill.date)} · due {formatDate(bill.dueDate)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-2 text-[13px] font-bold">{formatMoney(total.toFixed(2), "BDT")}</span>
                    {actions.length > 0 ? <RowActions actions={actions} /> : null}
                  </div>
                </div>

                {bill.status === "DRAFT" && bill.sentBackAt ? (
                  <div className="mt-2.5">
                    <PanelNotice>
                      Sent back by {bill.sentBackByUser?.fullName ?? bill.sentBackByUser?.email ?? "someone"}: {bill.rejectionNote}
                    </PanelNotice>
                  </div>
                ) : null}

                {bill.creditNotes.length > 0 ? (
                  <div className="mt-3 space-y-2 border-t border-[#EEF1F5] pt-3">
                    <h3 className={`text-[11px] font-bold tracking-wide uppercase ${TONE.muted}`}>Credit notes</h3>
                    {bill.creditNotes.map((note) => {
                      const noteTotal = note.lines.reduce((s, l) => s + Number(l.amount) + Number(l.vatAmount), 0)
                      const noteStatus = creditNoteStatus(note)
                      const noteCanApprove = canEdit && note.status === "DRAFT" && isSuperAdmin && note.createdBy !== user?.id
                      return (
                        <div
                          key={note.id}
                          ref={(el) => {
                            rowRefs.current[note.id] = el
                          }}
                          className={flashId === note.id ? "rounded-md bg-[#FFFBEF] px-2 py-1.5" : "px-2 py-1.5"}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                            <div className="min-w-0">
                              <span className="font-semibold">{formatDate(note.date)}</span>{" "}
                              <span className={TONE.muted}>{note.reason}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Tag label={noteStatus.label} tone={noteStatus.tone} />
                              <span className="font-bold">{formatMoney(noteTotal.toFixed(2), "BDT")}</span>
                              {noteCanApprove ? (
                                <RowActions
                                  actions={[
                                    {
                                      kind: "custom",
                                      label: "Approve",
                                      icon: <RiCheckLine className="size-3.5" aria-hidden />,
                                      onClick: () => { setError(null); setApprovingCn(note) },
                                    },
                                  ]}
                                />
                              ) : null}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      <div className="space-y-3">
        <h3 className="font-heading text-[13.5px] font-bold tracking-tight">Supplier payments</h3>
        {supplierPayments.length === 0 ? (
          <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
            <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>No supplier payments recorded yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {supplierPayments.map((p) => {
              const reversed = p.reversedAt !== null
              const settles = p.allocations.map((a) => a.bill?.billNumber ?? billNumberOf(a.billId))
              const actions = [
                ...(canEdit && !reversed && isSuperAdmin
                  ? [
                      {
                        kind: "custom" as const,
                        label: "Reverse",
                        icon: <RiArrowGoBackLine className="size-3.5" aria-hidden />,
                        onClick: () => { setError(null); setReversingPayment(p); setReverseReason("") },
                      },
                    ]
                  : []),
              ]
              return (
                <li key={p.id} className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className={`min-w-0 ${reversed ? "line-through opacity-60" : ""}`}>
                      <div className="text-[13.5px] font-bold">{supplierNameOf(p.supplierId)}</div>
                      <div className={`mt-0.5 text-[12px] ${TONE.muted}`}>
                        {formatDate(p.date)}
                        {p.currency === "USD" && p.sourceAmount ? ` · ${formatMoney(p.sourceAmount, "USD")} at ${Number(p.fxRateToBdt).toFixed(2)}` : ""}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="mr-2 text-[13px] font-bold">{formatMoney(p.amount, "BDT")}</span>
                      {actions.length > 0 ? <RowActions actions={actions} /> : null}
                    </div>
                  </div>

                  {reversed ? <p className={`mt-2 text-[12px] ${TONE.danger}`}>Reversed: {p.reversalReason}</p> : null}

                  <div className={`mt-2.5 border-t border-[#EEF1F5] pt-2.5 text-[12px] ${reversed ? "line-through opacity-60" : TONE.muted}`}>
                    {settles.length > 0 ? `Settles ${settles.join(", ")}` : "Not yet matched to a bill"}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {addingBill ? (
        <BillDialog
          open
          onOpenChange={(open) => !open && setAddingBill(false)}
          opportunityId={opportunityId}
          productLines={productLines}
          onSaved={() => {
            setAddingBill(false)
            invalidate()
          }}
        />
      ) : null}

      {editingBill ? (
        <BillDialog
          open
          onOpenChange={(open) => !open && setEditingBill(null)}
          opportunityId={opportunityId}
          productLines={productLines}
          bill={editingBill}
          onSaved={() => {
            setEditingBill(null)
            invalidate()
          }}
        />
      ) : null}

      {fixingBill ? (
        <BillCreditNoteDialog
          open
          onOpenChange={(open) => !open && setFixingBill(null)}
          bill={fixingBill}
          onSaved={() => {
            setFixingBill(null)
            invalidate()
          }}
        />
      ) : null}

      {paying ? (
        <PaymentDialog
          open
          onOpenChange={(open) => !open && setPaying(false)}
          opportunityId={opportunityId}
          bills={bills}
          onSaved={() => {
            setPaying(false)
            invalidate()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={approvingBill !== null}
        title={`Approve bill ${approvingBill?.billNumber ?? ""}?`}
        body={
          approvingBill
            ? `When you approve it, what we owe ${approvingBill.supplier.name} is counted in the accounts, dated ${formatDate(approvingBill.date)}. After that it cannot be changed. To fix a mistake later, use "Fix this bill".`
            : ""
        }
        confirmLabel="Approve"
        pending={approve.isPending}
        onCancel={() => setApprovingBill(null)}
        onConfirm={() => approvingBill && approve.mutate(approvingBill.id)}
      />

      <ConfirmDialog
        open={approvingCn !== null}
        title="Approve this credit note?"
        body={approvingCn ? `Approving reduces what we owe the supplier on this bill, dated ${formatDate(approvingCn.date)}.` : ""}
        confirmLabel="Approve"
        pending={approveCn.isPending}
        onCancel={() => setApprovingCn(null)}
        onConfirm={() => approvingCn && approveCn.mutate(approvingCn.id)}
      />

      <Dialog open={sendingBackBill !== null} onOpenChange={(open) => !open && setSendingBackBill(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send back bill {sendingBackBill?.billNumber}?</DialogTitle>
            <DialogDescription>Say what needs to change. The person who prepared it will see your note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Note" htmlFor="bill-send-back-note">
              <Textarea
                id="bill-send-back-note"
                rows={3}
                value={sendBackNote}
                onChange={(e) => setSendBackNote(e.target.value)}
                placeholder="What is wrong with this bill"
              />
            </Field>
            {error ? <FormError>{error}</FormError> : null}
          </div>
          <DialogFooter>
            <DialogActions
              pending={sendBack.isPending}
              disabled={!sendBackNote.trim()}
              submitLabel="Send back"
              onCancel={() => setSendingBackBill(null)}
              onSubmit={() => sendBack.mutate()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reversingPayment !== null} onOpenChange={(open) => !open && setReversingPayment(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse this payment?</DialogTitle>
            <DialogDescription>
              {reversingPayment ? `This undoes ${formatMoney(reversingPayment.amount, "BDT")} paid on ${formatDate(reversingPayment.date)}. Say why.` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Reason" htmlFor="pay-reverse-reason">
              <Textarea
                id="pay-reverse-reason"
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
              pending={reversePayment.isPending}
              disabled={!reverseReason.trim()}
              submitLabel="Reverse"
              onCancel={() => setReversingPayment(null)}
              onSubmit={() => reversePayment.mutate()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
