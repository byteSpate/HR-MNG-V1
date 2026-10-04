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
  createDepartment,
  deleteDepartment,
  listDepartments,
  updateDepartment,
} from "@/lib/api/departments"
import type { Department } from "@/lib/api/types"
import { countText } from "@/components/import-export/import-dialog"
import { HR_ROLES, ImportExportTools } from "@/components/import-export/import-export-tools"
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

export function DepartmentsPanel({ accessToken }: { accessToken: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Department | "new" | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    data: departments = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["departments"],
    queryFn: () => listDepartments(accessToken),
  })

  const done = () => {
    setEditing(null)
    setDeleting(null)
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["departments"] })
  }

  const saveMutation = useMutation({
      mutationFn: ({ id, name, costNature }: { id: string | null; name: string; costNature: Department["costNature"] }) =>
      id === null
        ? createDepartment(accessToken, { name, costNature })
        : updateDepartment(accessToken, id, { name, costNature }),
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDepartment(accessToken, id),
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
      title="Departments"
      sub="Every employee belongs to one. A department in use cannot be deleted."
      actionLabel="Add department"
      onAction={add}
      extra={
        <ImportExportTools
          basePath="/api/departments"
          fileName="departments"
          roles={HR_ROLES}
          onError={setError}
          exportDisabled={isLoading || isError}
          importer={{
            title: "Import departments",
            noun: "department",
            previewColumns: [
              { header: "Name", cell: (row) => String(row.name ?? "") },
              { header: "Cost type", cell: (row) => String(row.costNature ?? "") },
            ],
            summaryText: (summary) => `${countText(summary.departments ?? 0, "department")} will be added.`,
            onImported: () => queryClient.invalidateQueries({ queryKey: ["departments"] }),
          }}
        />
      }
      error={error}
      onDismissError={() => setError(null)}
    >
      <PanelTable
        cols="2fr 0.8fr"
        headers={["Department", ""]}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyTitle="No departments yet"
        emptyBody="Employees, announcements and assets are all filed under a department, so this is the first table to fill in."
        emptyAction="Add department"
        onEmptyAction={add}
        rows={departments.map((department) => [
          { text: department.name, weight: 600 },
          {
            node: (
              <RowActions
                actions={[
                  {
                    kind: "edit",
                    label: "Rename",
                    onClick: () => {
                      setError(null)
                      setEditing(department)
                    },
                  },
                  {
                    kind: "delete",
                    label: "Delete",
                    onClick: () => {
                      setError(null)
                      setDeleting(department)
                    },
                  },
                ]}
              />
            ),
          },
        ])}
      />

      {/* Mounted only while open, so the name field seeds from a useState
          initialiser rather than an effect. Base UI's onOpenChange never fires
          for a prop-driven `open`, so seeding there would silently never run. */}
      {editing !== null ? (
        <DepartmentDialog
          department={editing === "new" ? null : editing}
          pending={saveMutation.isPending}
          error={error}
          onClose={() => setEditing(null)}
           onSave={(name, costNature) =>
             saveMutation.mutate({ id: editing === "new" ? null : editing.id, name, costNature })
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

function DepartmentDialog({
  department,
  pending,
  error,
  onClose,
  onSave,
}: {
  department: Department | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (name: string, costNature: Department["costNature"]) => void
}) {
  const [name, setName] = useState(department?.name ?? "")
  const [costNature, setCostNature] = useState<Department["costNature"]>(department?.costNature ?? "ADMINISTRATIVE")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{department ? "Rename department" : "Add a department"}</DialogTitle>
          <DialogDescription>
            Names are unique. Renaming one moves every employee, announcement and asset with it,
            because they reference it by id.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Name" htmlFor="department-name">
            <Input
              id="department-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Cost nature" htmlFor="department-nature">
            <select id="department-nature" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={costNature} onChange={(e) => setCostNature(e.target.value as Department["costNature"])}>
              <option value="DIRECT">Direct (cost of sales)</option>
              <option value="ADMINISTRATIVE">Administrative (overhead)</option>
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Departments that build what the company sells are a direct cost and appear in Cost of Goods Sold. Everything else is overhead.</p>
          </Field>

          {error ? <FormError>{error}</FormError> : null}

          <DialogFooter>
            <DialogActions
              pending={pending}
              disabled={name.trim().length === 0}
              submitLabel={department ? "Save" : "Add department"}
              onCancel={onClose}
              onSubmit={() => onSave(name.trim(), costNature)}
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
