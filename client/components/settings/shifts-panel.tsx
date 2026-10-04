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
import { Label } from "@/components/ui/label"
import { createShift, deleteShift, listShifts, updateShift } from "@/lib/api/shifts"
import type { Shift, ShiftImpact, ShiftInput } from "@/lib/api/types"
import { countText } from "@/components/import-export/import-dialog"
import { HR_ROLES, ImportExportTools } from "@/components/import-export/import-export-tools"
import {
  ConfirmDeleteDialog,
  DialogActions,
  Field,
  FormError,
  PanelFrame,
  PanelNotice,
  PanelTable,
  RowActions,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"

/**
 * The attendance grid resolves the fallback shift by this literal name for
 * every employee whose shiftId is null, and throws when it is absent. The
 * server refuses to delete or rename it; this constant is why the UI does not
 * offer to.
 */
const DEFAULT_SHIFT_NAME = "General"

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const describeOffDays = (days: number[]): string =>
  days.length === 0 ? "None" : days.map((d) => DAY_LABELS[d]).join(", ")

export function ShiftsPanel({ accessToken }: { accessToken: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Shift | "new" | null>(null)
  const [deleting, setDeleting] = useState<Shift | null>(null)
  const [impact, setImpact] = useState<ShiftImpact | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    data: shifts = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["shifts"],
    queryFn: () => listShifts(accessToken),
  })

  const refresh = () => {
    setEditing(null)
    setDeleting(null)
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["shifts"] })
  }

  const saveMutation = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: ShiftInput }) =>
      id === null
        ? createShift(accessToken, input).then(() => undefined)
        : updateShift(accessToken, id, input).then((result) => result.impact),
    onSuccess: (result) => {
      setImpact(result ?? null)
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteShift(accessToken, id),
    onSuccess: refresh,
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
      title="Shifts"
      sub="Working hours and weekly off days. Employees without an explicit shift fall back to General."
      actionLabel="Add shift"
      onAction={add}
      extra={
        <ImportExportTools
          basePath="/api/attendance/shifts"
          fileName="shifts"
          roles={HR_ROLES}
          onError={setError}
          exportDisabled={isLoading || isError}
          importer={{
            title: "Import shifts",
            noun: "shift",
            previewColumns: [
              { header: "Name", cell: (row) => String(row.name ?? "") },
              { header: "Start", cell: (row) => String(row.startTime ?? "") },
              { header: "End", cell: (row) => String(row.endTime ?? "") },
              { header: "Break (min)", cell: (row) => String(row.breakMinutes ?? "") },
              { header: "Grace (min)", cell: (row) => String(row.graceMinutes ?? "") },
              {
                header: "Weekly off",
                cell: (row) => (Array.isArray(row.weeklyOffDays) ? row.weeklyOffDays.join(";") : ""),
              },
            ],
            summaryText: (summary) => `${countText(summary.shifts ?? 0, "shift")} will be added.`,
            onImported: () => queryClient.invalidateQueries({ queryKey: ["shifts"] }),
          }}
        />
      }
      error={error}
      onDismissError={() => setError(null)}
    >
      {/* Changing the weekly off days re-derives every past attendance day for
          everyone on this shift, in a different module from this screen. The
          write has already happened; this states what it did. */}
      {impact ? (
        <PanelNotice onDismiss={() => setImpact(null)}>
          The weekly off days changed, so attendance re-derives for{" "}
          <strong>{impact.affectedEmployees}</strong> employee
          {impact.affectedEmployees === 1 ? "" : "s"}
          {impact.earliestAffectedDate
            ? ` back to ${impact.earliestAffectedDate}.`
            : ". No attendance has been recorded for them yet."}
        </PanelNotice>
      ) : null}

      <PanelTable
        cols="1.2fr 0.9fr 0.7fr 1fr 0.8fr"
        headers={["Shift", "Hours", "Grace", "Weekly off", ""]}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyTitle="No shifts found"
        emptyBody="Attendance expects a shift named General to fall back to. If this list is empty the database has not been seeded."
        emptyAction="Add shift"
        onEmptyAction={add}
        rows={shifts.map((shift) => {
          const isDefault = shift.name === DEFAULT_SHIFT_NAME
          return [
            {
              text: shift.name,
              sub: isDefault ? "Company default" : undefined,
              weight: 600,
            },
            {
              text: `${shift.startTime} to ${shift.endTime}`,
              sub: `${shift.breakMinutes} min break`,
            },
            { text: `${shift.graceMinutes} min` },
            { text: describeOffDays(shift.weeklyOffDays) },
            {
              node: (
                <RowActions
                  actions={[
                    {
                      kind: "edit",
                      label: "Edit",
                      onClick: () => {
                        setError(null)
                        setEditing(shift)
                      },
                    },
                    isDefault
                      ? {
                          kind: "locked",
                          label: "Required",
                          hint: "Attendance resolves this shift by name for everyone without an explicit shift.",
                        }
                      : {
                          kind: "delete",
                          label: "Delete",
                          onClick: () => {
                            setError(null)
                            setDeleting(shift)
                          },
                        },
                  ]}
                />
              ),
            },
          ]
        })}
      />

      {editing !== null ? (
        <ShiftEditDialog
          shift={editing === "new" ? null : editing}
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
        what={deleting ? `the ${deleting.name} shift` : ""}
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </PanelFrame>
  )
}

/**
 * Edits a shift *definition* — its name, hours and weekly off.
 *
 * Named apart from `components/employees/shift-dialog.tsx`, which assigns a
 * shift *to an employee*. Both were called ShiftDialog, so the two opposite
 * subjects shared one name and whoever opened the wrong file lost ten minutes.
 */
function ShiftEditDialog({
  shift,
  pending,
  error,
  onClose,
  onSave,
}: {
  shift: Shift | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: ShiftInput) => void
}) {
  const [name, setName] = useState(shift?.name ?? "")
  const [startTime, setStartTime] = useState(shift?.startTime ?? "09:00")
  const [endTime, setEndTime] = useState(shift?.endTime ?? "18:00")
  const [breakMinutes, setBreakMinutes] = useState(String(shift?.breakMinutes ?? 60))
  const [graceMinutes, setGraceMinutes] = useState(String(shift?.graceMinutes ?? 15))
  const [offDays, setOffDays] = useState<number[]>(shift?.weeklyOffDays ?? [5])

  const isDefault = shift?.name === DEFAULT_SHIFT_NAME

  const toggleDay = (day: number) =>
    setOffDays((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()
    )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{shift ? `Edit ${shift.name}` : "Add a shift"}</DialogTitle>
          <DialogDescription>
            Break minutes sit inside the span, so 09:00 to 18:00 with a 60-minute break is a
            nine-hour day and nothing subtracts the break again downstream.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field
            label="Name"
            htmlFor="shift-name"
            hint={
              isDefault
                ? "Attendance looks this shift up by name for every employee without an explicit one, so it cannot be renamed. Its hours below are yours to change."
                : undefined
            }
          >
            <Input
              id="shift-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isDefault}
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Start" htmlFor="shift-start">
              <Input
                id="shift-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </Field>
            <Field label="End" htmlFor="shift-end">
              <Input
                id="shift-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </Field>
            <Field label="Break (minutes)" htmlFor="shift-break">
              <Input
                id="shift-break"
                type="number"
                min={0}
                max={480}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
              />
            </Field>
            <Field label="Late allowance (minutes)" htmlFor="shift-grace">
              <Input
                id="shift-grace"
                type="number"
                min={0}
                max={240}
                value={graceMinutes}
                onChange={(e) => setGraceMinutes(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-1.5">
            <Label className="text-[12px] font-bold text-[#1C2733]">Weekly off days</Label>
            {/* Seven day toggles read as one control rather than seven stray
                checkboxes. Buttons carrying `role="checkbox"` rather than a
                visually-hidden Checkbox: hiding the real control would take
                its focus ring with it. */}
            <div role="group" aria-label="Weekly off days" className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((label, day) => {
                const active = offDays.includes(day)
                return (
                  <button
                    key={label}
                    type="button"
                    role="checkbox"
                    aria-checked={active}
                    onClick={() => toggleDay(day)}
                    className={`rounded-md border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-[#17191C]/25 active:translate-y-px ${
                      active
                        ? "border-[#17191C] bg-[#17191C] text-white hover:bg-[#0E1012]"
                        : "border-[#E4E9EF] bg-white text-[#5F6B7C] hover:border-[#C9D2DE] hover:text-[#1C2733]"
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {shift && offDays.join() !== shift.weeklyOffDays.join() ? (
              <p className={`text-[11.5px] leading-relaxed font-semibold ${TONE.notice}`}>
                Changing these re-derives every past attendance day for everyone on this shift.
              </p>
            ) : null}
          </div>

          {error ? <FormError>{error}</FormError> : null}

          <DialogFooter>
            <DialogActions
              pending={pending}
              disabled={name.trim().length === 0}
              submitLabel={shift ? "Save" : "Add shift"}
              onCancel={onClose}
              onSubmit={() =>
                onSave({
                  name: name.trim(),
                  startTime,
                  endTime,
                  breakMinutes: Number(breakMinutes),
                  graceMinutes: Number(graceMinutes),
                  weeklyOffDays: offDays,
                })
              }
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
