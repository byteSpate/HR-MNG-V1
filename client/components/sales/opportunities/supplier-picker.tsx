"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { findSimilarSuppliers, listSupplierOptions, quickAddSupplier } from "@/lib/api/supplier"
import { useSession } from "@/lib/auth/session-context"
import { DialogActions, Field, FormError, toMessage } from "@/components/dashboard/record-kit"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

/** A sentinel, never sent to the server: picking it opens the add dialog instead of picking a supplier. */
const ADD_NEW = "__add-new-supplier__"

const SUPPLIER_OPTIONS_KEY = ["supplier-options"]

/**
 * Settles on a value once typing pauses, so a suggestion request is not sent
 * per keystroke. A private copy of `opportunity-detail.tsx`'s helper of the
 * same name and shape (that one is unexported, so this file keeps its own,
 * matching how small helpers like `formatDate` are already duplicated
 * per-file across this codebase).
 */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * The small "+ Add a new supplier" dialog. Its own state, own mutation, own
 * query, so closing it (Add, Cancel, or picking a suggestion) never touches
 * the product-line form behind it.
 */
function AddSupplierDialog({
  open,
  onOpenChange,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (supplierId: string) => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const term = useDebounced(name.trim(), 250)

  const close = () => {
    setName("")
    setError(null)
    onOpenChange(false)
  }

  const similar = useQuery({
    queryKey: ["supplier-similar", term],
    queryFn: () => findSimilarSuppliers(accessToken!, term),
    enabled: !!accessToken && term.length > 0,
    placeholderData: (previous) => previous,
  })

  const add = useMutation({
    mutationFn: () => quickAddSupplier(accessToken!, name.trim()),
    onSuccess: (supplier) => {
      queryClient.invalidateQueries({ queryKey: SUPPLIER_OPTIONS_KEY })
      onChange(supplier.id)
      close()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const pickSuggestion = (supplier: { id: string; name: string }) => {
    // The existing supplier is picked, never created again: the point of
    // "did you mean" is to stop a near-duplicate supplier being added.
    onChange(supplier.id)
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new supplier</DialogTitle>
          <DialogDescription>Only the name is needed now. Finance adds the rest later.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="Supplier name" htmlFor="new-supplier-name">
            <Input id="new-supplier-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          {(similar.data ?? []).length > 0 ? (
            <div className="space-y-1">
              {similar.data!.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="block text-left text-[12.5px] font-semibold text-[#8A5E0C] underline"
                >
                  Did you mean: {s.name}?
                </button>
              ))}
            </div>
          ) : null}

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={add.isPending}
            disabled={!name.trim()}
            submitLabel="Add"
            onCancel={close}
            onSubmit={() => add.mutate()}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Who we will buy a product line from: a select of active suppliers, plus a
 * sentinel last option that opens a small add-supplier dialog rather than
 * being picked itself. Empty string means no supplier chosen, matching how
 * the rest of the product-line form uses "" for "not set yet".
 */
export function SupplierPicker({ value, onChange }: { value: string; onChange: (supplierId: string) => void }) {
  const { accessToken } = useSession()
  const [dialogOpen, setDialogOpen] = useState(false)

  const options = useQuery({
    queryKey: SUPPLIER_OPTIONS_KEY,
    queryFn: () => listSupplierOptions(accessToken!),
    enabled: !!accessToken,
  })

  return (
    <>
      <select
        id="line-supplier"
        className={SELECT}
        value={value}
        onChange={(e) => {
          if (e.target.value === ADD_NEW) {
            setDialogOpen(true)
            return
          }
          onChange(e.target.value)
        }}
      >
        <option value="">Choose a supplier</option>
        {(options.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
        <option value={ADD_NEW}>+ Add a new supplier</option>
      </select>

      <AddSupplierDialog open={dialogOpen} onOpenChange={setDialogOpen} onChange={onChange} />
    </>
  )
}
