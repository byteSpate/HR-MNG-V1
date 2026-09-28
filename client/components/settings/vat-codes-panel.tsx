"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { createVatCode, listVatCodes, updateVatCode, type CreateVatCodeInput } from "@/lib/api/vatCode"
import type { VatCode } from "@/lib/api/types"
import {
  CheckboxField,
  DialogActions,
  Field,
  FormError,
  PanelFrame,
  PanelTable,
  RowActions,
  toMessage,
} from "@/components/dashboard/record-kit"

/**
 * VAT codes have no delete endpoint (a VAT code an approved invoice or bill
 * already used has to keep meaning what it always meant), so this panel only
 * ever adds or edits — never the cost-categories panel's delete flow.
 * Deactivating a code is done through the Edit dialog's Active field.
 */
export function VatCodesPanel({ accessToken }: { accessToken: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<VatCode | "new" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    data: codes = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    // `all: true` — a code someone turned off still has to be listed here to
    // edit it back on, unlike the active-only ["vat-codes"] lists the invoice
    // and bill dialogs use to pick a rate for a new line.
    queryKey: ["vat-codes", "all"],
    queryFn: () => listVatCodes(accessToken, { all: true }),
  })

  const done = () => {
    setEditing(null)
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["vat-codes"] })
  }

  const saveMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string | null
      input: CreateVatCodeInput & { isActive: boolean }
    }) => {
      if (id === null) {
        const { isActive, ...rest } = input
        void isActive
        return createVatCode(accessToken, rest)
      }
      const { code, ...rest } = input
      void code
      return updateVatCode(accessToken, id, rest)
    },
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })

  const add = () => {
    setError(null)
    setEditing("new")
  }

  return (
    <PanelFrame
      title="VAT codes"
      sub="The VAT rates used on invoice and supplier bill lines."
      actionLabel="New VAT code"
      onAction={add}
      error={error}
      onDismissError={() => setError(null)}
    >
      <PanelTable
        cols="0.8fr 1.6fr 0.7fr 0.8fr 0.7fr"
        headers={["Code", "Name", "Rate", "Active", ""]}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyTitle="No VAT codes yet"
        emptyBody="Invoices and supplier bills have no VAT rate to use until one exists."
        emptyAction="New VAT code"
        onEmptyAction={add}
        rows={codes.map((code) => [
          { text: code.code, weight: 600 },
          { text: code.name },
          { text: `${Number(code.ratePercent)}%` },
          {
            node: (
              <Badge variant={code.isActive ? "default" : "secondary"}>
                {code.isActive ? "Active" : "Inactive"}
              </Badge>
            ),
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
                      setEditing(code)
                    },
                  },
                ]}
              />
            ),
          },
        ])}
      />

      {editing !== null ? (
        <VatCodeDialog
          code={editing === "new" ? null : editing}
          pending={saveMutation.isPending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            saveMutation.mutate({ id: editing === "new" ? null : editing.id, input })
          }
        />
      ) : null}
    </PanelFrame>
  )
}

function VatCodeDialog({
  code,
  pending,
  error,
  onClose,
  onSave,
}: {
  code: VatCode | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: CreateVatCodeInput & { isActive: boolean }) => void
}) {
  const [codeValue, setCodeValue] = useState(code?.code ?? "")
  const [name, setName] = useState(code?.name ?? "")
  const [ratePercent, setRatePercent] = useState(code?.ratePercent ?? "")
  const [isActive, setIsActive] = useState(code?.isActive ?? true)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{code ? `Edit ${code.name}` : "Add a VAT code"}</DialogTitle>
          <DialogDescription>
            The VAT rate used on new invoice and supplier bill lines.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Code"
              htmlFor="vc-code"
              hint={code ? "Fixed. Documents already use this code." : undefined}
            >
              <Input
                id="vc-code"
                value={codeValue}
                onChange={(e) => setCodeValue(e.target.value.toUpperCase())}
                disabled={code !== null}
                placeholder="STD"
              />
            </Field>
            <Field label="Name" htmlFor="vc-name">
              <Input id="vc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard rate" />
            </Field>
          </div>

          <Field
            label="Rate"
            htmlFor="vc-rate"
            hint="A new rate is used for new lines. Approved invoices and bills keep their VAT."
          >
            <Input
              id="vc-rate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              placeholder="15"
            />
          </Field>

          <CheckboxField label="Active" checked={isActive} onChange={setIsActive} />

          {error ? <FormError>{error}</FormError> : null}

          <DialogFooter>
            <DialogActions
              pending={pending}
              disabled={
                name.trim().length === 0 || codeValue.trim().length === 0 || ratePercent.trim().length === 0
              }
              submitLabel={code ? "Save" : "Add VAT code"}
              onCancel={onClose}
              onSubmit={() =>
                onSave({
                  code: codeValue.trim(),
                  name: name.trim(),
                  ratePercent: ratePercent.trim(),
                  isActive,
                })
              }
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
