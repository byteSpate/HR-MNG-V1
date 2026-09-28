"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"

import { updateReceiptCertificates, type CertificatesInput } from "@/lib/api/receipt"
import { useSession } from "@/lib/auth/session-context"
import type { Receipt } from "@/lib/api/types"
import { DialogActions, Field, FormError, toMessage } from "@/components/dashboard/record-kit"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

/**
 * Records the withholding certificate (VDS and/or AIT) a receipt is still
 * missing. Moved out of `components/accounting/receipt-page.tsx`'s
 * `CertificateDialog` (deal-money-simplify Task 20), made self-contained:
 * its own mutation, `open` / `onOpenChange` / `onSaved`, instead of taking
 * `pending`/`error`/`onSave` from a parent page's own mutation.
 */
export function CertificateDialog({
  open,
  onOpenChange,
  receipt,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  receipt: Receipt
  onSaved: (receipt: Receipt) => void
}) {
  const { accessToken } = useSession()
  const needsVds = Number(receipt.vdsAmount) > 0 && !receipt.vdsCertificateRef
  const needsAit = Number(receipt.aitAmount) > 0 && !receipt.aitCertificateRef
  const [vdsCertificateRef, setVdsCertificateRef] = useState("")
  const [vdsCertificateDate, setVdsCertificateDate] = useState("")
  const [aitCertificateRef, setAitCertificateRef] = useState("")
  const [aitCertificateDate, setAitCertificateDate] = useState("")
  const [error, setError] = useState<string | null>(null)

  const canSubmit =
    (!needsVds || Boolean(vdsCertificateRef.trim() && vdsCertificateDate)) &&
    (!needsAit || Boolean(aitCertificateRef.trim() && aitCertificateDate))

  const save = useMutation({
    mutationFn: (input: CertificatesInput) => updateReceiptCertificates(accessToken!, receipt.id, input),
    onSuccess: (saved) => {
      setError(null)
      onSaved(saved)
    },
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add the certificate</DialogTitle>
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
            pending={save.isPending}
            disabled={!canSubmit}
            submitLabel="Save"
            onCancel={() => onOpenChange(false)}
            onSubmit={() =>
              save.mutate({
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
