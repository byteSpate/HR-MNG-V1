"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { RiAddLine, RiArrowGoBackLine, RiCheckLine, RiFileEditLine } from "@remixicon/react"

import { approveInvoice } from "@/lib/api/invoice"
import { approveCustomerCreditNote } from "@/lib/api/customerCreditNote"
import { sendBackApproval } from "@/lib/api/dealMoney"
import { useSession } from "@/lib/auth/session-context"
import type { CustomerPo, DealMoneyCustomerCreditNote, DealMoneyInvoice } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import type { MoneyHighlight } from "@/components/money/money-section"
import { BillingDetailsDialog } from "@/components/money/billing-details-dialog"
import { CreditNoteDialog } from "@/components/money/credit-note-dialog"
import { InvoiceDialog } from "@/components/money/invoice-dialog"
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

function invoiceTotals(inv: DealMoneyInvoice): { net: number; vat: number; total: number } {
  const net = inv.lines.reduce((s, l) => s + Number(l.amount), 0)
  const vat = inv.lines.reduce((s, l) => s + Number(l.vatAmount), 0)
  return { net, vat, total: net + vat }
}

function lineRemaining(line: CustomerPo["lines"][number]): number {
  return Number(line.amount) - line.invoiceLines.reduce((s, il) => s + Number(il.amount), 0)
}

/** A PO still open, with something left on at least one line to invoice. */
function poHasSomethingLeft(po: CustomerPo): boolean {
  return po.status === "OPEN" && po.lines.some((l) => lineRemaining(l) > 0.004)
}

/**
 * The four labels the design asks for (Draft, Waiting for approval, Sent
 * back, Approved), worked out from the two real status values an invoice
 * carries (`ReceivableDocStatus` is DRAFT or APPROVED here — never REVERSED,
 * an invoice cannot be reversed) plus `sentBackAt`. There is no separate
 * "Draft" a person ever sees: a DRAFT invoice that has never been sent back
 * reads as "Waiting for approval", which is what it is the moment it is
 * saved — the person who typed it does not additionally see it as an
 * unfinished draft sitting apart from the approval queue.
 */
function invoiceStatus(inv: DealMoneyInvoice): { label: string; tone: Tone } {
  if (inv.status === "APPROVED") return { label: "Approved", tone: "green" }
  if (inv.sentBackAt) return { label: "Sent back", tone: "yellow" }
  return { label: "Waiting for approval", tone: "neutral" }
}

function creditNoteStatus(note: DealMoneyCustomerCreditNote): { label: string; tone: Tone } {
  return note.status === "APPROVED" ? { label: "Approved", tone: "green" } : { label: "Waiting for approval", tone: "neutral" }
}

/**
 * The Invoiced part of the Money section: every invoice on this deal, its
 * nested credit notes, and (only for Finance, `canEdit`) the buttons to
 * create, edit, approve, send back or fix one.
 *
 * Reads `pos` and `data.deal.customer` already loaded by the sibling parts
 * (`PoPart`'s data, `MoneySection`'s own fetch) — no second query.
 */
export function InvoicedPart({
  invoices,
  pos,
  customer,
  canEdit,
  invalidate,
  highlight,
}: {
  invoices: DealMoneyInvoice[]
  pos: CustomerPo[]
  customer: { id: string; legalName: string; billingAddress: string | null; paymentDays: number } | null
  canEdit: boolean
  invalidate: () => void
  highlight?: MoneyHighlight | null
}) {
  const { accessToken, user } = useSession()
  const isSuperAdmin = user?.role === "SUPER_ADMIN"

  const [billingForPo, setBillingForPo] = useState<CustomerPo | null>(null)
  const [creatingForPo, setCreatingForPo] = useState<CustomerPo | null>(null)
  const [editingInvoice, setEditingInvoice] = useState<DealMoneyInvoice | null>(null)
  const [fixingInvoice, setFixingInvoice] = useState<DealMoneyInvoice | null>(null)
  const [approvingInvoice, setApprovingInvoice] = useState<DealMoneyInvoice | null>(null)
  const [sendingBackInvoice, setSendingBackInvoice] = useState<DealMoneyInvoice | null>(null)
  const [sendBackNote, setSendBackNote] = useState("")
  const [approvingCn, setApprovingCn] = useState<DealMoneyCustomerCreditNote | null>(null)
  const [error, setError] = useState<string | null>(null)

  const approve = useMutation({
    mutationFn: (id: string) => approveInvoice(accessToken!, id),
    onSuccess: () => {
      setApprovingInvoice(null)
      setError(null)
      invalidate()
    },
    onError: (err) => {
      setApprovingInvoice(null)
      setError(toMessage(err))
    },
  })

  const sendBack = useMutation({
    mutationFn: () => sendBackApproval(accessToken!, "INVOICE", sendingBackInvoice!.id, sendBackNote.trim()),
    onSuccess: () => {
      setSendingBackInvoice(null)
      setSendBackNote("")
      setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const approveCn = useMutation({
    mutationFn: (id: string) => approveCustomerCreditNote(accessToken!, id),
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

  // Scroll a highlighted invoice or nested credit note into view and flash
  // it, when the Waiting-for-approval queue links here with one open
  // (Task 23 builds that link; this reads it now). Kept deliberately small —
  // a ref map plus a timed class, not a generic highlight framework.
  // Holds both invoice `<li>` and nested credit-note `<div>` nodes — one map
  // keyed by id is simpler than two, and the callback refs below widen
  // either element type to this on assignment.
  const rowRefs = useRef<Record<string, HTMLElement | null>>({})
  const [flashId, setFlashId] = useState<string | null>(null)
  const highlightedId =
    highlight?.kind === "INVOICE" || highlight?.kind === "CUSTOMER_CREDIT_NOTE" ? highlight.id : null

  useEffect(() => {
    if (!highlightedId) return
    const el = rowRefs.current[highlightedId]
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    setFlashId(highlightedId)
    const timer = setTimeout(() => setFlashId(null), 2200)
    return () => clearTimeout(timer)
  }, [highlightedId])

  const eligiblePos = pos.filter(poHasSomethingLeft)

  const startCreate = (po: CustomerPo) => {
    setError(null)
    if (!customer || !customer.billingAddress?.trim()) {
      setBillingForPo(po)
    } else {
      setCreatingForPo(po)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-[15px] font-bold tracking-tight">Invoiced</h2>
        {canEdit && eligiblePos.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {eligiblePos.map((po) => (
              <Button
                key={po.id}
                type="button"
                onClick={() => startCreate(po)}
                className="h-8 gap-1 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
              >
                <RiAddLine className="size-3.5" aria-hidden />
                Create invoice ({po.serial})
              </Button>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      {invoices.length === 0 ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
          <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>
            {pos.length === 0
              ? "No invoices yet. Record the customer's PO first."
              : "No invoices yet. Create one once the PO has something left to invoice."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {invoices.map((inv) => {
            const { total } = invoiceTotals(inv)
            const status = invoiceStatus(inv)
            // Approve and Send back, together. Hidden from whoever created
            // or last saved the draft (the server refuses both of them), and
            // on a draft already sent back and not saved again (the server
            // refuses to approve it until its preparer saves it).
            const canApprove =
              canEdit &&
              inv.status === "DRAFT" &&
              isSuperAdmin &&
              inv.createdBy !== user?.id &&
              inv.updatedBy !== user?.id &&
              !inv.sentBackAt
            const actions = [
              ...(canEdit && inv.status === "DRAFT"
                ? [{ kind: "edit" as const, label: "Edit", onClick: () => { setError(null); setEditingInvoice(inv) } }]
                : []),
              ...(canApprove
                ? [
                    {
                      kind: "custom" as const,
                      label: "Approve",
                      icon: <RiCheckLine className="size-3.5" aria-hidden />,
                      onClick: () => { setError(null); setApprovingInvoice(inv) },
                    },
                    {
                      kind: "custom" as const,
                      label: "Send back",
                      icon: <RiArrowGoBackLine className="size-3.5" aria-hidden />,
                      onClick: () => { setError(null); setSendingBackInvoice(inv); setSendBackNote("") },
                    },
                  ]
                : []),
              ...(canEdit && inv.status === "APPROVED"
                ? [
                    {
                      kind: "custom" as const,
                      label: "Fix this invoice",
                      icon: <RiFileEditLine className="size-3.5" aria-hidden />,
                      onClick: () => { setError(null); setFixingInvoice(inv) },
                    },
                  ]
                : []),
            ]

            return (
              <li
                key={inv.id}
                ref={(el) => {
                  rowRefs.current[inv.id] = el
                }}
                className={cn(
                  "rounded-md border bg-white px-4 py-4 transition-colors sm:px-5.5 sm:py-5",
                  flashId === inv.id ? "border-[#E7C46B] bg-[#FFFBEF]" : "border-[#E4E9EF]"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-bold">{inv.invoiceNumber}</span>
                      <Tag label={status.label} tone={status.tone} />
                    </div>
                    <div className={`mt-0.5 text-[12px] ${TONE.muted}`}>
                      {formatDate(inv.date)} · due {formatDate(inv.dueDate)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-2 text-[13px] font-bold">{formatMoney(total.toFixed(2), "BDT")}</span>
                    {actions.length > 0 ? <RowActions actions={actions} /> : null}
                  </div>
                </div>

                {inv.status === "DRAFT" && inv.sentBackAt ? (
                  <div className="mt-2.5">
                    <PanelNotice>
                      Sent back by {inv.sentBackByUser?.fullName ?? inv.sentBackByUser?.email ?? "someone"}: {inv.rejectionNote}
                    </PanelNotice>
                  </div>
                ) : null}

                {inv.creditNotes.length > 0 ? (
                  <div className="mt-3 space-y-2 border-t border-[#EEF1F5] pt-3">
                    <h3 className={`text-[11px] font-bold tracking-wide uppercase ${TONE.muted}`}>Credit notes</h3>
                    {inv.creditNotes.map((note) => {
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

      {billingForPo ? (
        <BillingDetailsDialog
          open
          onOpenChange={(open) => !open && setBillingForPo(null)}
          customer={
            customer ?? { id: billingForPo.customer.id, legalName: billingForPo.customer.legalName, billingAddress: null, paymentDays: 30 }
          }
          onSaved={() => {
            const po = billingForPo
            setBillingForPo(null)
            invalidate()
            setCreatingForPo(po)
          }}
        />
      ) : null}

      {creatingForPo ? (
        <InvoiceDialog
          open
          onOpenChange={(open) => !open && setCreatingForPo(null)}
          po={creatingForPo}
          onSaved={() => {
            setCreatingForPo(null)
            invalidate()
          }}
        />
      ) : null}

      {editingInvoice ? (
        <InvoiceDialog
          open
          onOpenChange={(open) => !open && setEditingInvoice(null)}
          invoice={editingInvoice}
          onSaved={() => {
            setEditingInvoice(null)
            invalidate()
          }}
        />
      ) : null}

      {fixingInvoice ? (
        <CreditNoteDialog
          open
          onOpenChange={(open) => !open && setFixingInvoice(null)}
          invoice={fixingInvoice}
          onSaved={() => {
            setFixingInvoice(null)
            invalidate()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={approvingInvoice !== null}
        title={`Approve invoice ${approvingInvoice?.invoiceNumber ?? ""}?`}
        body={
          approvingInvoice
            ? `When you approve it, the sale, its VAT and the cost of the goods are counted in the accounts, dated ${formatDate(approvingInvoice.date)}. After that it cannot be changed. To fix a mistake later, use "Fix this invoice".`
            : ""
        }
        confirmLabel="Approve"
        pending={approve.isPending}
        onCancel={() => setApprovingInvoice(null)}
        onConfirm={() => approvingInvoice && approve.mutate(approvingInvoice.id)}
      />

      <ConfirmDialog
        open={approvingCn !== null}
        title="Approve this credit note?"
        body={approvingCn ? `Approving reduces what the customer owes on this invoice, dated ${formatDate(approvingCn.date)}.` : ""}
        confirmLabel="Approve"
        pending={approveCn.isPending}
        onCancel={() => setApprovingCn(null)}
        onConfirm={() => approvingCn && approveCn.mutate(approvingCn.id)}
      />

      <Dialog open={sendingBackInvoice !== null} onOpenChange={(open) => !open && setSendingBackInvoice(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send back invoice {sendingBackInvoice?.invoiceNumber}?</DialogTitle>
            <DialogDescription>Say what needs to change. The person who prepared it will see your note.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Note" htmlFor="inv-send-back-note">
              <Textarea
                id="inv-send-back-note"
                rows={3}
                value={sendBackNote}
                onChange={(e) => setSendBackNote(e.target.value)}
                placeholder="What is wrong with this invoice"
              />
            </Field>
            {error ? <FormError>{error}</FormError> : null}
          </div>
          <DialogFooter>
            <DialogActions
              pending={sendBack.isPending}
              disabled={!sendBackNote.trim()}
              submitLabel="Send back"
              onCancel={() => setSendingBackInvoice(null)}
              onSubmit={() => sendBack.mutate()}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
