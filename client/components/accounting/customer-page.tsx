"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { createCustomer, listCustomers, updateCustomer } from "@/lib/api/customer"
import { useSession } from "@/lib/auth/session-context"
import type { Customer } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import {
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  PanelTable,
  RowActions,
  toMessage,
} from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

interface CustomerFormInput {
  legalName: string
  billingAddress?: string
  bin?: string
  paymentDays?: number
}

/** "Aug 17, 2026" — the same short date the rest of accounting uses. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function CustomerPage() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Customer | "new" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: () => listCustomers(accessToken!),
    enabled: Boolean(accessToken),
  })

  const done = () => {
    setEditing(null)
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["customers"] })
  }

  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: CustomerFormInput }) =>
      id === null ? createCustomer(accessToken!, input) : updateCustomer(accessToken!, id, input),
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })

  const add = () => {
    setError(null)
    setEditing("new")
  }

  const rows: TableCell[][] = (customers.data ?? []).map((c) => [
    { text: c.legalName, weight: 600 },
    { text: c.bin ?? "—" },
    { text: `${c.paymentDays} days` },
    { text: formatDate(c.createdAt) },
    {
      node: (
        <RowActions
          actions={[
            {
              kind: "edit",
              label: "Edit",
              onClick: () => {
                setError(null)
                setEditing(c)
              },
            },
          ]}
        />
      ),
    },
  ])

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Accounting"
        title="Customers"
        sub="Every company we invoice, and what they owe."
        cta="New customer"
        onCta={add}
      />

      {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

      <PanelTable
        cols="1.6fr 1fr 0.9fr 1fr 0.7fr"
        headers={["Legal name", "BIN", "Payment days", "Created", ""]}
        rows={rows}
        isLoading={customers.isPending}
        isError={customers.isError}
        onRetry={() => customers.refetch()}
        emptyTitle="No customers yet"
        emptyBody="A Customer is created automatically once a Sales Account's first deal is Won, or added here directly. That automatic link is not built yet."
        emptyAction="New customer"
        onEmptyAction={add}
      />

      {editing !== null ? (
        <CustomerDialog
          customer={editing === "new" ? null : editing}
          pending={save.isPending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) => save.mutate({ id: editing === "new" ? null : editing.id, input })}
        />
      ) : null}
    </div>
  )
}

function CustomerDialog({
  customer,
  pending,
  error,
  onClose,
  onSave,
}: {
  customer: Customer | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: CustomerFormInput) => void
}) {
  const [legalName, setLegalName] = useState(customer?.legalName ?? "")
  const [billingAddress, setBillingAddress] = useState(customer?.billingAddress ?? "")
  const [bin, setBin] = useState(customer?.bin ?? "")
  const [paymentDays, setPaymentDays] = useState(String(customer?.paymentDays ?? 30))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{customer ? `Edit ${customer.legalName}` : "New customer"}</DialogTitle>
          <DialogDescription>
            The name that will appear on a tax invoice. Which Sales Account this customer came
            from, if any, is set once and never changed here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Legal name" htmlFor="cust-name">
            <Input
              id="cust-name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Acme Corporation Ltd."
            />
          </Field>
          <Field label="Billing address" htmlFor="cust-address">
            <Input
              id="cust-address"
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
            />
          </Field>
          <Field label="BIN" htmlFor="cust-bin" hint="The customer's own VAT registration number.">
            <Input id="cust-bin" value={bin} onChange={(e) => setBin(e.target.value)} />
          </Field>
          <Field label="Payment days" htmlFor="cust-days">
            <Input
              id="cust-days"
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
            disabled={legalName.trim().length === 0}
            submitLabel={customer ? "Save" : "Add customer"}
            onCancel={onClose}
            onSubmit={() =>
              onSave({
                legalName: legalName.trim(),
                billingAddress: billingAddress.trim() || undefined,
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
