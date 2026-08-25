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
import { Input } from "@/components/ui/input"
import {
  createCostCategory,
  deleteCostCategory,
  listCostCategories,
  updateCostCategory,
} from "@/lib/api/costs"
import type { CostCategory, CreateCostCategoryInput } from "@/lib/api/types"
import {
  ConfirmDeleteDialog,
  DialogActions,
  Field,
  FormError,
  PanelFrame,
  PanelTable,
  RowActions,
  toMessage,
} from "@/components/dashboard/record-kit"

export function CostCategoriesPanel({ accessToken }: { accessToken: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<CostCategory | "new" | null>(null)
  const [deleting, setDeleting] = useState<CostCategory | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    data: categories = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["cost-categories"],
    queryFn: () => listCostCategories(accessToken),
  })

  const done = () => {
    setEditing(null)
    setDeleting(null)
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["cost-categories"] })
  }

  const saveMutation = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: CreateCostCategoryInput }) => {
      if (id === null) return createCostCategory(accessToken, input)
      const { code, ...rest } = input
      void code
      return updateCostCategory(accessToken, id, rest)
    },
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCostCategory(accessToken, id),
    onSuccess: done,
    onError: (err) => {
      setDeleting(null)
      setError(toMessage(err))
    },
  })

  const add = () => {
    setError(null)
    setEditing("new")
  }

  return (
    <PanelFrame
      title="Cost categories"
      sub="What company expenses are booked against. One with costs or fixed costs against it cannot be deleted."
      actionLabel="Add category"
      onAction={add}
      error={error}
      onDismissError={() => setError(null)}
    >
      <PanelTable
        cols="2fr 0.8fr"
        headers={["Category", ""]}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyTitle="No cost categories yet"
        emptyBody="Company expenses are booked against one of these, so the costs module has nowhere to file anything until one exists."
        emptyAction="Add category"
        onEmptyAction={add}
        rows={categories.map((category) => [
          { text: category.name, sub: category.code, weight: 600 },
          {
            node: (
              <RowActions
                actions={[
                  {
                    kind: "edit",
                    label: "Rename",
                    onClick: () => {
                      setError(null)
                      setEditing(category)
                    },
                  },
                  {
                    kind: "delete",
                    label: "Delete",
                    onClick: () => {
                      setError(null)
                      setDeleting(category)
                    },
                  },
                ]}
              />
            ),
          },
        ])}
      />

      {editing !== null ? (
        <CostCategoryDialog
          category={editing === "new" ? null : editing}
          pending={saveMutation.isPending}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            saveMutation.mutate({ id: editing === "new" ? null : editing.id, input })
          }
        />
      ) : null}

      <ConfirmDeleteDialog
        open={deleting !== null}
        what={deleting?.name ?? ""}
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </PanelFrame>
  )
}

function CostCategoryDialog({
  category,
  pending,
  error,
  onClose,
  onSave,
}: {
  category: CostCategory | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: CreateCostCategoryInput) => void
}) {
  const [code, setCode] = useState(category?.code ?? "")
  const [name, setName] = useState(category?.name ?? "")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? `Edit ${category.name}` : "Add a cost category"}</DialogTitle>
          <DialogDescription>
            A table rather than a fixed list, because Finance will add &ldquo;gas bill&rdquo; and no
            code branches on the name.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Code"
              htmlFor="cc-code"
              hint={category ? "Fixed. Rules key off the code." : undefined}
            >
              <Input
                id="cc-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={category !== null}
                placeholder="GAS"
              />
            </Field>
            <Field label="Name" htmlFor="cc-name">
              <Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>

          {error ? <FormError>{error}</FormError> : null}

          <DialogFooter>
            <DialogActions
              pending={pending}
              disabled={name.trim().length === 0 || code.trim().length === 0}
              submitLabel={category ? "Save" : "Add category"}
              onCancel={onClose}
              onSubmit={() => onSave({ code: code.trim(), name: name.trim() })}
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
