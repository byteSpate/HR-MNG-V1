"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { updateCustomer } from "@/lib/api/customer"
import { useSession } from "@/lib/auth/session-context"
import { DialogActions, Field, FormError, toMessage } from "@/components/dashboard/record-kit"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

/**
 * Asks for the three things an invoice needs on the customer (legal name,
 * billing address, payment days) when one is missing, before the invoice
 * dialog opens (deal-money design, "The documents", "Rules"). Self-contained
 * like every other Money section dialog: its own mutation, `open` /
 * `onOpenChange` / `onSaved`.
 */
export function BillingDetailsDialog({
  open,
  onOpenChange,
  customer,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: { id: string; legalName: string; billingAddress: string | null; paymentDays: number }
  onSaved: () => void
}) {
  const { accessToken } = useSession()
  const [legalName, setLegalName] = useState(customer.legalName)
  const [billingAddress, setBillingAddress] = useState(customer.billingAddress ?? "")
  const [paymentDays, setPaymentDays] = useState(String(customer.paymentDays || 30))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      updateCustomer(accessToken!, customer.id, {
        legalName: legalName.trim(),
        billingAddress: billingAddress.trim(),
        paymentDays: Number(paymentDays),
      }),
    onSuccess: () => {
      setError(null)
      onSaved()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const canSubmit = Boolean(legalName.trim() && billingAddress.trim() && Number(paymentDays) > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Billing details for {customer.legalName}</DialogTitle>
          <DialogDescription>An invoice needs these three things. Add them once, here.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Legal name" htmlFor="bd-legal-name">
            <Input id="bd-legal-name" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </Field>
          <Field label="Billing address" htmlFor="bd-billing-address">
            <Textarea id="bd-billing-address" rows={3} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder="Street, city, country" />
          </Field>
          <Field label="Payment days" htmlFor="bd-payment-days" hint="How many days the customer has to pay, counted from the invoice date.">
            <Input id="bd-payment-days" type="number" min={1} value={paymentDays} onChange={(e) => setPaymentDays(e.target.value)} />
          </Field>
          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions pending={save.isPending} disabled={!canSubmit} submitLabel="Save" onCancel={() => onOpenChange(false)} onSubmit={() => save.mutate()} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
