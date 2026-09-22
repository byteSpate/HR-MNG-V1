"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { createSupplier, deactivateSupplier, listSuppliers, updateSupplier } from "@/lib/api/supplier"
import { useSession } from "@/lib/auth/session-context"
import type { Supplier } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import {
  ConfirmDialog,
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  PanelTable,
  RowActions,
  toMessage,
} from "@/components/dashboard/record-kit"
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
import { Input } from "@/components/ui/input"

interface SupplierFormInput {
  name: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  bin?: string
  paymentDays?: number
}

export function SupplierPage() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Supplier | "new" | null>(null)
  const [deactivating, setDeactivating] = useState<Supplier | null>(null)
  const [error, setError] = useState<string | null>(null)

  const suppliers = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => listSuppliers(accessToken!),
    enabled: Boolean(accessToken),
  })

  const done = () => {
    setEditing(null)
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["suppliers"] })
  }

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: SupplierFormInput }) =>
      id === null ? createSupplier(accessToken!, input) : updateSupplier(accessToken!, id, input),
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => deactivateSupplier(accessToken!, id),
    onSuccess: () => {
      setDeactivating(null)
      queryClient.invalidateQueries({ queryKey: ["suppliers"] })
    },
    onError: (err) => {
      setDeactivating(null)
      setError(toMessage(err))
    },
  })

  const add = () => {
    setError(null)
    setEditing("new")
  }

  const rows: TableCell[][] = (suppliers.data ?? []).map((s) => [
    { text: s.name, weight: 600 },
    {
      text: s.contactName ?? "—",
      sub: s.contactPhone ?? s.contactEmail ?? undefined,
    },
    { text: s.bin ?? "—" },
    { text: `${s.paymentDays} days` },
    {
      node: <Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Active" : "Inactive"}</Badge>,
    },
    {
      node: (
        <RowActions
          actions={[
            {
              kind: "edit",
              label: "Edit",
              onClick: () => {
                setError(null)
                setEditing(s)
              },
            },
            ...(s.isActive
              ? [
                  {
                    kind: "custom" as const,
                    label: "Deactivate",
                    icon: null,
                    onClick: () => {
                      setError(null)
                      setDeactivating(s)
                    },
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Suppliers"
        sub="Every company we buy from, and what we owe them."
        cta="New supplier"
        onCta={add}
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      <PanelTable
        cols="1.4fr 1.2fr 0.9fr 0.9fr 0.8fr 0.9fr"
        headers={["Name", "Contact", "BIN", "Payment days", "Status", ""]}
        rows={rows}
        isLoading={suppliers.isPending}
        isError={suppliers.isError}
        onRetry={() => suppliers.refetch()}
        emptyTitle="No suppliers yet"
        emptyBody="Add one before recording a bill against them."
        emptyAction="New supplier"
        onEmptyAction={add}
      />

      {editing !== null ? (
        <SupplierDialog
          supplier={editing === "new" ? null : editing}
          pending={save.isPending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate({ id: editing === "new" ? null : editing.id, input })}
        />
      ) : null}

      <ConfirmDialog
        open={deactivating !== null}
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        body="Deactivating hides this supplier from new bill entry. Its history is unaffected, and it can be reactivated later by editing it."
        confirmLabel="Deactivate"
        pending={deactivate.isPending}
        onCancel={() => setDeactivating(null)}
        onConfirm={() => deactivating && deactivate.mutate(deactivating.id)}
      />
    </div>
  )
}

function SupplierDialog({
  supplier,
  pending,
  error,
  onClose,
  onSave,
}: {
  supplier: Supplier | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: SupplierFormInput) => void
}) {
  const [name, setName] = useState(supplier?.name ?? "")
  const [contactName, setContactName] = useState(supplier?.contactName ?? "")
  const [contactPhone, setContactPhone] = useState(supplier?.contactPhone ?? "")
  const [contactEmail, setContactEmail] = useState(supplier?.contactEmail ?? "")
  const [bin, setBin] = useState(supplier?.bin ?? "")
  const [paymentDays, setPaymentDays] = useState(String(supplier?.paymentDays ?? 30))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.name}` : "New supplier"}</DialogTitle>
          <DialogDescription>
            Star Tech, Smart Technologies, or any other company we buy from for a deal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Name" htmlFor="sup-name">
            <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Star Tech" />
          </Field>
          <Field label="Contact name" htmlFor="sup-contact-name">
            <Input id="sup-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </Field>
          <Field label="Contact phone" htmlFor="sup-contact-phone">
            <Input id="sup-contact-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </Field>
          <Field label="Contact email" htmlFor="sup-contact-email">
            <Input
              id="sup-contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </Field>
          <Field label="BIN" htmlFor="sup-bin" hint="The supplier's own VAT registration number.">
            <Input id="sup-bin" value={bin} onChange={(e) => setBin(e.target.value)} />
          </Field>
          <Field label="Payment days" htmlFor="sup-days">
            <Input
              id="sup-days"
              type="number"
              min={0}
              max={365}
              value={paymentDays}
              onChange={(e) => setPaymentDays(e.target.value)}
            />
          </Field>
          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={name.trim().length === 0}
            submitLabel={supplier ? "Save" : "Add supplier"}
            onCancel={onClose}
            onSubmit={() =>
              onSave({
                name: name.trim(),
                contactName: contactName.trim() || undefined,
                contactPhone: contactPhone.trim() || undefined,
                contactEmail: contactEmail.trim() || undefined,
                bin: bin.trim() || undefined,
                paymentDays: paymentDays.trim() === "" ? undefined : Number(paymentDays),
              })
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
