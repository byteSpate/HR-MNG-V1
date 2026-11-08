"use client"

import { useState, type ReactNode } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createLeaveType,
  deleteLeaveType,
  listLeaveTypes,
  updateLeaveType,
} from "@/lib/api/leave"
import type {
  CreateLeaveTypeInput,
  EmploymentType,
  LeaveAccrualBasis,
  LeaveType,
} from "@/lib/api/types"
import {
  CheckboxField,
  ConfirmDeleteDialog,
  DialogActions,
  Field,
  FormError,
  PanelFrame,
  PanelTable,
  RowActions,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import { dialogWidthClass } from "@/components/ds/dialog-sizes"

const ACCRUAL_BASES: LeaveAccrualBasis[] = ["PRO_RATED", "PER_EVENT", "EARNED", "NONE"]

const ACCRUAL_LABEL: Record<string, string> = {
  PRO_RATED: "Pro-rated across the joining year",
  PER_EVENT: "Full quota per occasion",
  EARNED: "Earned from days worked",
  NONE: "No entitlement",
}

const EMPLOYMENT_TYPES: EmploymentType[] = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]

const EMPLOYMENT_LABEL: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Intern",
}

export function LeaveTypesPanel({ accessToken }: { accessToken: string }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LeaveType | "new" | null>(null)
  const [deleting, setDeleting] = useState<LeaveType | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    data: leaveTypes = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => listLeaveTypes(accessToken),
  })

  const done = () => {
    setEditing(null)
    setDeleting(null)
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["leave-types"] })
  }

  const saveMutation = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: CreateLeaveTypeInput }) => {
      if (id === null) return createLeaveType(accessToken, input)
      // `code` is immutable, so it never goes in an update body.
      const { code, ...rest } = input
      void code
      return updateLeaveType(accessToken, id, rest)
    },
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLeaveType(accessToken, id),
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
      title="Leave types"
      sub="Statutory types come from the Bangladesh Labour Act. They can be made more generous, never less."
      actionLabel="Add leave type"
      onAction={add}
      error={error}
      onDismissError={() => setError(null)}
    >
      <PanelTable
        cols="1.3fr 0.7fr 0.9fr 1fr 0.8fr"
        headers={["Type", "Quota", "Accrual", "Eligible", ""]}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyTitle="No leave types found"
        emptyBody="The statutory types are created by the seed. An empty list means they were never loaded, and no leave can be applied for until they are."
        emptyAction="Add leave type"
        onEmptyAction={add}
        rows={leaveTypes.map((type) => [
          {
            text: type.name,
            sub: type.statutory ? `${type.code} · statutory` : type.code,
            weight: 600,
          },
          {
            text: type.accrualBasis === "EARNED" ? "Earned" : `${type.annualQuota} days`,
            sub: type.isPaid ? "Paid" : "Unpaid",
          },
          { text: ACCRUAL_LABEL[type.accrualBasis] ?? type.accrualBasis },
          {
            text: type.eligibleFor.map((e) => EMPLOYMENT_LABEL[e] ?? e).join(", "),
            sub:
              type.minServiceMonths > 0
                ? `After ${type.minServiceMonths} months' service`
                : undefined,
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
                      setEditing(type)
                    },
                  },
                  type.statutory
                    ? {
                        kind: "locked",
                        label: "Statutory",
                        hint: "Granted by the Labour Act. It can be raised, but not removed.",
                      }
                    : {
                        kind: "delete",
                        label: "Delete",
                        onClick: () => {
                          setError(null)
                          setDeleting(type)
                        },
                      },
                ]}
              />
            ),
          },
        ])}
      />

      {editing !== null ? (
        <LeaveTypeDialog
          leaveType={editing === "new" ? null : editing}
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

/**
 * Thirteen fields in one scrolling column is a wall. Grouping them under the
 * question each group answers is the only structure that survives the type
 * being statutory, where roughly half of them lock.
 */
function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-[#EEF1F5] pt-4 first:border-0 first:pt-0">
      <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>{title}</h3>
      {children}
    </section>
  )
}

function LeaveTypeDialog({
  leaveType,
  pending,
  error,
  onClose,
  onSave,
}: {
  leaveType: LeaveType | null
  pending: boolean
  error: string | null
  onClose: () => void
  onSave: (input: CreateLeaveTypeInput) => void
}) {
  const [code, setCode] = useState(leaveType?.code ?? "")
  const [name, setName] = useState(leaveType?.name ?? "")
  const [annualQuota, setAnnualQuota] = useState(String(leaveType?.annualQuota ?? 0))
  const [carryForwardPct, setCarryForwardPct] = useState(String(leaveType?.carryForwardPct ?? 0))
  const [maxConsecutive, setMaxConsecutive] = useState(
    leaveType?.maxConsecutive === null || leaveType?.maxConsecutive === undefined
      ? ""
      : String(leaveType.maxConsecutive)
  )
  const [maxAccrual, setMaxAccrual] = useState(
    leaveType?.maxAccrual === null || leaveType?.maxAccrual === undefined
      ? ""
      : String(leaveType.maxAccrual)
  )
  const [minServiceMonths, setMinServiceMonths] = useState(String(leaveType?.minServiceMonths ?? 0))
  const [isPaid, setIsPaid] = useState(leaveType?.isPaid ?? true)
  const [allowsBackdating, setAllowsBackdating] = useState(leaveType?.allowsBackdating ?? false)
  const [countsHolidays, setCountsHolidays] = useState(leaveType?.countsHolidays ?? false)
  const [allowsHalfDay, setAllowsHalfDay] = useState(leaveType?.allowsHalfDay ?? true)
  const [accrualBasis, setAccrualBasis] = useState<LeaveAccrualBasis>(
    leaveType?.accrualBasis ?? "PRO_RATED"
  )
  const [eligibleFor, setEligibleFor] = useState<EmploymentType[]>(
    leaveType?.eligibleFor ?? ["FULL_TIME"]
  )

  // Mirrors assertStatutoryUpdateAllowed on the server. An affordance, not the
  // enforcement: the server's 409 is the authority and is shown verbatim.
  const locked = leaveType?.statutory ?? false

  const toggleEligible = (type: EmploymentType) =>
    setEligibleFor((current) =>
      current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
    )

  const nullableNumber = (value: string): number | null =>
    value.trim() === "" ? null : Number(value)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={dialogWidthClass("lg")}>
        <DialogHeader>
          <DialogTitle>{leaveType ? `Edit ${leaveType.name}` : "Add a leave type"}</DialogTitle>
          <DialogDescription>
            {locked
              ? "This type is granted by the Labour Act. You can be more generous than the statute, but not less, and the rules that decide how it is computed are fixed."
              : "A company-policy type. Nothing here is fixed by statute."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] space-y-4 overflow-y-auto pr-1">
          <FormSection title="Identity">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Code"
                htmlFor="lt-code"
                hint={leaveType ? "Fixed. Policy rules are looked up by code, never by name." : undefined}
              >
                <Input
                  id="lt-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  disabled={leaveType !== null}
                  placeholder="STUDY"
                />
              </Field>
              <Field label="Name" htmlFor="lt-name">
                <Input id="lt-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Entitlement">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Annual quota (days)"
                htmlFor="lt-quota"
                hint={
                  locked && leaveType ? `At least ${leaveType.annualQuota}, by statute.` : undefined
                }
              >
                <Input
                  id="lt-quota"
                  type="number"
                  min={0}
                  max={365}
                  value={annualQuota}
                  onChange={(e) => setAnnualQuota(e.target.value)}
                />
              </Field>

              <Field
                label="Carry-forward (%)"
                htmlFor="lt-carry"
                hint={
                  locked && leaveType
                    ? `At least ${leaveType.carryForwardPct}%, by statute.`
                    : undefined
                }
              >
                <Input
                  id="lt-carry"
                  type="number"
                  min={0}
                  max={100}
                  value={carryForwardPct}
                  onChange={(e) => setCarryForwardPct(e.target.value)}
                />
              </Field>

              <Field
                label="Longest single absence (days)"
                htmlFor="lt-maxrun"
                hint={
                  locked && leaveType?.maxConsecutive === null
                    ? "Unlimited by statute, so it cannot be capped."
                    : "Leave blank for no limit."
                }
              >
                <Input
                  id="lt-maxrun"
                  type="number"
                  min={1}
                  max={365}
                  value={maxConsecutive}
                  onChange={(e) => setMaxConsecutive(e.target.value)}
                  placeholder="No limit"
                />
              </Field>

              <Field
                label="Accrual ceiling (days)"
                htmlFor="lt-maxaccrual"
                hint={
                  locked && leaveType && leaveType.maxAccrual !== null
                    ? `At least ${leaveType.maxAccrual}, by statute.`
                    : undefined
                }
              >
                <Input
                  id="lt-maxaccrual"
                  type="number"
                  min={1}
                  max={365}
                  value={maxAccrual}
                  onChange={(e) => setMaxAccrual(e.target.value)}
                  placeholder="No ceiling"
                />
              </Field>
            </div>

            <Field
              label="How entitlement is calculated"
              htmlFor="lt-accrual"
              hint={
                locked
                  ? "Fixed. This decides which section of the Act applies, not how generous the company is, so there is no more generous direction to move it in."
                  : undefined
              }
            >
              <Select
                value={accrualBasis}
                onValueChange={(v) => setAccrualBasis(v as LeaveAccrualBasis)}
                disabled={locked}
              >
                <SelectTrigger id="lt-accrual" className="w-full">
                  <SelectValue>
                    {(value: string | null) =>
                      value === null ? "Select…" : (ACCRUAL_LABEL[value] ?? value)
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ACCRUAL_BASES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {ACCRUAL_LABEL[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FormSection>

          <FormSection title="Who can take it">
            <Field
              label="Minimum service (months)"
              htmlFor="lt-service"
              /* This one inverts: a waiting period is more generous when it is
                 shorter, so the statutory rule is a ceiling, not a floor. */
              hint={
                locked && leaveType
                  ? `At most ${leaveType.minServiceMonths}, by statute. A shorter wait is more generous, so this is the one limit that works the other way round.`
                  : undefined
              }
            >
              <Input
                id="lt-service"
                type="number"
                min={0}
                max={120}
                value={minServiceMonths}
                onChange={(e) => setMinServiceMonths(e.target.value)}
              />
            </Field>

            <div className="grid gap-1.5">
              <Label className="text-[12px] font-bold text-[#1C2733]">
                Eligible employment types
              </Label>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {EMPLOYMENT_TYPES.map((type) => (
                  <CheckboxField
                    key={type}
                    label={EMPLOYMENT_LABEL[type]}
                    checked={eligibleFor.includes(type)}
                    onChange={() => toggleEligible(type)}
                  />
                ))}
              </div>
              {locked ? (
                <p className={`text-[11.5px] leading-relaxed ${TONE.muted}`}>
                  You can cover more employment types than the Act requires, but not fewer.
                </p>
              ) : null}
            </div>
          </FormSection>

          <FormSection title="How it behaves">
            <div className="grid gap-1 sm:grid-cols-2">
              <CheckboxField
                label="Paid leave"
                checked={isPaid}
                onChange={setIsPaid}
                disabled={locked}
              />
              <CheckboxField
                label="Can be filed after the fact"
                checked={allowsBackdating}
                onChange={setAllowsBackdating}
                disabled={locked}
              />
              <CheckboxField
                label="Holidays inside the range count as leave"
                checked={countsHolidays}
                onChange={setCountsHolidays}
                disabled={locked}
              />
              <CheckboxField
                label="Can be taken as a half day"
                checked={allowsHalfDay}
                onChange={setAllowsHalfDay}
                disabled={locked}
              />
            </div>
            {locked ? (
              <p className={`text-[11.5px] leading-relaxed ${TONE.muted}`}>
                These four say how the statute is applied rather than how much is granted, so they
                are fixed for a statutory type.
              </p>
            ) : null}
          </FormSection>

          {error ? <FormError>{error}</FormError> : null}
        </div>

        <DialogFooter>
          <DialogActions
            pending={pending}
            disabled={
              name.trim().length === 0 || code.trim().length === 0 || eligibleFor.length === 0
            }
            submitLabel={leaveType ? "Save" : "Add leave type"}
            onCancel={onClose}
            onSubmit={() =>
              onSave({
                code: code.trim(),
                name: name.trim(),
                annualQuota: Number(annualQuota),
                carryForwardPct: Number(carryForwardPct),
                maxConsecutive: nullableNumber(maxConsecutive),
                maxAccrual: nullableNumber(maxAccrual),
                minServiceMonths: Number(minServiceMonths),
                isPaid,
                allowsBackdating,
                countsHolidays,
                allowsHalfDay,
                accrualBasis,
                eligibleFor,
              })
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
