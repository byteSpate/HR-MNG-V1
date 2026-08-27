"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { getEmployee, setAccountActive, setSalaryStructure, updateEmployee } from "@/lib/api/employees"
import { listSalaryStructures } from "@/lib/api/payroll"
import { listShifts } from "@/lib/api/shifts"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { EmployeeView } from "@/lib/api/types"
import { SalaryStructureDialog } from "@/components/employees/salary-structure-dialog"
import { ShiftDialog } from "@/components/employees/shift-dialog"
import {
  CARD_FIELDS,
  EditCardDialog,
  EMPLOYMENT_TYPE_LABEL,
} from "@/components/profile/edit-card-dialog"
import { EditNameDialog } from "@/components/profile/edit-name-dialog"
import { HrChangeEmailDialog } from "@/components/profile/hr-change-email-dialog"
import { ExitDetailsDialog } from "@/components/profile/exit-details-dialog"
import { DocumentsCard } from "@/components/profile/documents-card"
import { LeaveBalanceCard } from "@/components/profile/leave-balance-card"
import { HoldingsCard } from "@/components/asset/holdings-card"
import { PayslipsCard } from "@/components/payroll/payslips-card"
import { ProfileCard, formatDateValue } from "@/components/profile/profile-card"
import { ProfileHeader } from "@/components/profile/profile-header"
import { ProfileInsights } from "@/components/profile/profile-insights"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Renders whichever groups are present in the payload.
 *
 * There is no role check anywhere in this file. The server projects by tier,
 * so a group the caller cannot see is a key that is absent — and because every
 * group key on `EmployeeView` is optional, reading one without a guard fails
 * `tsc` rather than crashing at runtime.
 *
 * The alternative — the client deciding what to show from the viewer's role —
 * means the same matrix is written twice, and when the two drift the laxer one
 * promises data the server will not return.
 */
export function EmployeeDetailPage({
  employeeId,
  backHref,
}: {
  employeeId: string
  backHref: string
}) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [assigningStructure, setAssigningStructure] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assigningShift, setAssigningShift] = useState(false)
  const [shiftError, setShiftError] = useState<string | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)

  const employeeQuery = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: () => getEmployee(accessToken!, employeeId),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  // Fetched only once the dialog is actually opened — the caller who may see
  // this page without ever assigning a structure shouldn't pay for the list.
  const structuresQuery = useQuery({
    queryKey: ["salary-structures"],
    queryFn: () => listSalaryStructures(accessToken!),
    enabled: assigningStructure && sessionStatus === "authenticated" && !!accessToken,
  })

  // Same lazy-fetch reasoning, and the same `["shifts"]` key the create-
  // employee form uses — whichever dialog opens first, the other gets it
  // from cache.
  const shiftsQuery = useQuery({
    queryKey: ["shifts"],
    queryFn: () => listShifts(accessToken!),
    enabled: assigningShift && sessionStatus === "authenticated" && !!accessToken,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["employee", employeeId] })
    queryClient.invalidateQueries({ queryKey: ["employees"] })
  }

  // `employeeId` rather than `employee.id`: this mutation is declared
  // unconditionally, before the loading/error early returns below, so the
  // employee record itself may not exist yet.
  const assignMutation = useMutation({
    mutationFn: (salaryStructureId: string | null) =>
      setSalaryStructure(accessToken!, employeeId, salaryStructureId),
    onSuccess: () => {
      setAssigningStructure(false)
      setAssignError(null)
      refresh()
    },
    onError: (err) => {
      setAssignError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  // Goes through the general PATCH rather than a dedicated route — unlike
  // salary structure, shift has no month-lock or approval logic of its own to
  // protect, so it is a plain `HR_ONLY_EDITABLE_FIELDS` write like designation
  // or office location. `null` clears it back to the General shift, and is
  // sent explicitly for the same reason setSalaryStructure sends it: an
  // omitted key is a no-op, not a clear.
  const shiftMutation = useMutation({
    mutationFn: (shiftId: string | null) => updateEmployee(accessToken!, employeeId, { shiftId }),
    onSuccess: () => {
      setAssigningShift(false)
      setShiftError(null)
      refresh()
    },
    onError: (err) => {
      setShiftError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  // Same reason as assignMutation: declared before the early returns, so it
  // keys off `employeeId` rather than a record that may not exist yet.
  const accountMutation = useMutation({
    mutationFn: (isActive: boolean) => setAccountActive(accessToken!, employeeId, isActive),
    onSuccess: () => {
      setAccountError(null)
      refresh()
    },
    onError: (err) => {
      setAccountError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  if (sessionStatus === "loading" || employeeQuery.isPending) {
    return (
      <div className="space-y-3 pt-7">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (employeeQuery.isError) {
    return (
      <div className="mt-7 rounded-md border border-[#E4E9EF] bg-white p-5.5 text-[13px] text-[#B03A3A]">
        Could not load this employee.{" "}
        <Button variant="link" className="h-auto p-0 font-semibold underline" onClick={() => employeeQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const employee: EmployeeView = employeeQuery.data
  const canEdit = employee.editableFields.length > 0
  const canEditName = employee.editableFields.includes("fullName")
  // SUPER_ADMIN only, matching requireRole on PATCH /:id/account, so the
  // control can never 403 when pressed.
  const canToggleAccount = user?.role === "SUPER_ADMIN" && !!employee.employment
  const accountActive = employee.employment?.accountActive ?? true
  // Mirrors PAYROLL_ADMIN_ROLES in payroll.service, the same way
  // canToggleAccount mirrors requireRole on PATCH /:id/account. Everyone else
  // reaching this page is a Reporting Manager looking at a report, and the
  // service 403s them by design: a line manager has no payroll access, which
  // is a policy choice rather than an oversight. Rendering the card anyway
  // would turn that into an error message on a page that is otherwise fine.
  const canSeePayslips =
    user?.role === "HR_ADMIN" || user?.role === "FINANCE_OFFICER" || user?.role === "SUPER_ADMIN"
  // `shiftId` is HR-only on the server's write matrix — gating on the field
  // itself, the same way `editAction` does per card, rather than on role,
  // keeps this in step if that matrix ever changes.
  const canAssignShift = employee.editableFields.includes("shiftId")

  // HR-only, matching the server route. Not derived from `editableFields`:
  // the address is not on the employee write matrix at all, because it lives
  // on `User` and changing it is a different kind of act.
  const canChangeEmail = user?.role === "HR_ADMIN" || user?.role === "SUPER_ADMIN"

  // A card shows an Edit control if and only if it contains at least one
  // field this caller may write. No role check — editableFields comes from
  // the server's writableFieldsFor.
  const editAction = (card: string) =>
    (CARD_FIELDS[card] ?? []).some((f) => employee.editableFields.includes(f.key)) ? (
      <Button
        type="button"
        variant="link" className="h-auto p-0 text-[12.5px] font-semibold underline"
        onClick={() => setEditing(card)}
      >
        Edit
      </Button>
    ) : null

  return (
    <>
      <div className="pt-7 pb-4">
        <Link href={backHref} className="text-[12.5px] font-semibold text-[#7A8698] hover:underline">
          ← Back
        </Link>
      </div>

      <ProfileHeader
        employee={employee}
        avatarEditable={canEdit}
        onAvatarChanged={refresh}
        onEditName={canEditName ? () => setEditingName(true) : undefined}
        action={
          canEdit || canToggleAccount || canAssignShift ? (
            <>
              {canEdit ? (
                <>
                  <Button type="button" variant="outline" onClick={() => setAssigningStructure(true)}>
                    Assign salary structure
                  </Button>
                  {employee.exit === null ? (
                    <Button type="button" variant="outline" onClick={() => setExitOpen(true)}>
                      Record exit
                    </Button>
                  ) : null}
                </>
              ) : null}
              {canAssignShift ? (
                <Button type="button" variant="outline" onClick={() => setAssigningShift(true)}>
                  {employee.employment?.shift ? "Change shift" : "Assign shift"}
                </Button>
              ) : null}
              {/* Distinct from "Record exit": that ends the employment, this
                  ends the access. Either can happen without the other. */}
              {canToggleAccount ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={accountMutation.isPending}
                  onClick={() => accountMutation.mutate(!accountActive)}
                >
                  {accountMutation.isPending
                    ? "Saving…"
                    : accountActive
                      ? "Deactivate login"
                      : "Reactivate login"}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {accountError ? (
        <div className="mb-4 rounded-md border border-[#E4E9EF] bg-white px-5 py-3 text-[13px] text-[#B03A3A]">
          {accountError}
        </div>
      ) : null}

      {/* FULL only — blockers arrive for SELF and FULL, and this page is never
          SELF. Every blocker here is actionable, because the person reading
          the page is the person who resolves them. */}
      {(employee.blockers ?? []).length > 0 ? (
        <div className="mb-5 space-y-1.5">
          {employee.blockers!.map((b) => (
            <div
              key={`${b.field}-${b.blocks}`}
              className="rounded-md border border-[#F0DCC0] bg-[#FDF7EE] px-4 py-2.5 text-[13px] text-[#8A5A1E]"
            >
              {b.blocks}
            </div>
          ))}
        </div>
      ) : null}

      <ProfileInsights employeeId={employeeId} />

      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(310px,1fr))] gap-4">
        {employee.personal ? (
          <ProfileCard
            title="Personal"
            action={editAction("Personal")}
            rows={[
              { label: "Date of birth", value: formatDateValue(employee.personal.dateOfBirth) },
              { label: "Gender", value: employee.personal.gender },
              { label: "National ID", value: employee.personal.nationalId },
              { label: "Blood group", value: employee.personal.bloodGroup },
              { label: "Marital status", value: employee.personal.maritalStatus },
            ]}
          />
        ) : null}

        {employee.contact ? (
          <ProfileCard
            title="Contact"
            action={editAction("Contact")}
            rows={[
              {
                // Shown here because this is where people look for it, but it
                // is not edited by the Contact dialog: the address is the
                // sign-in identity, so changing it has its own HR-only route
                // and its own consequences. See `hr-change-email-dialog.tsx`.
                label: "Sign-in email",
                value: employee.work.email,
              },
              { label: "Phone", value: employee.work.phone },
              { label: "Present address", value: employee.contact.presentAddress },
              { label: "Permanent address", value: employee.contact.permanentAddress },
              { label: "Emergency contact", value: employee.contact.emergencyContact },
            ]}
            footer={
              canChangeEmail ? (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-[12.5px] font-semibold underline"
                  onClick={() => setEmailOpen(true)}
                >
                  Change sign-in email
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {employee.employment ? (
          <ProfileCard
            title="Employment"
            action={editAction("Employment")}
            rows={[
              // Designation is on the card because the Edit dialog offers it.
              // A field you can change but cannot see is as confusing as a
              // field you can see but cannot change.
              { label: "Designation", value: employee.work.designation },
              { label: "Employee code", value: employee.employment.employeeCode },
              {
                label: "Employment type",
                value: EMPLOYMENT_TYPE_LABEL[employee.employment.employmentType] ?? null,
              },
              { label: "Joining date", value: formatDateValue(employee.employment.joiningDate) },
              { label: "Office location", value: employee.employment.officeLocation },
              { label: "Shift", value: employee.employment.shift?.name ?? null },
              {
                label: "Reporting manager",
                value: employee.work.reportingManager?.fullName ?? null,
              },
            ]}
          />
        ) : null}

        {employee.payroll ? (
          <ProfileCard
            title="Payroll"
            action={editAction("Payroll")}
            rows={[
              { label: "Salary structure", value: employee.payroll.salaryStructure?.name ?? null },
              { label: "Bank", value: employee.payroll.bankName },
              { label: "Account number", value: employee.payroll.bankAccountNumber },
              { label: "Routing number", value: employee.payroll.bankRoutingNumber },
            ]}
          />
        ) : null}

        {employee.exit ? (
          <ProfileCard
            title="Exit"
            rows={[
              { label: "Last working day", value: formatDateValue(employee.exit.lastWorkingDay) },
              { label: "Reason", value: employee.exit.exitReason },
              { label: "Note", value: employee.exit.exitNote },
            ]}
          />
        ) : null}

        {/* Fetched separately: it comes from the leave module, not the employee
            payload, and a slow leave query should not delay the field cards. */}
        <LeaveBalanceCard employeeId={employeeId} />

        {/* Also fetched separately, from the asset module. Always rendered,
            never hidden behind a permission check — an empty state saying so
            is exactly what the exit conversation needs to see. */}
        <HoldingsCard employeeId={employeeId} />

        {/* Fetched from the payroll module for the same reason, and gated on
            role rather than on a group key: payslips are not part of the
            employee payload, so there is no absent key to read the answer
            from the way every card above does. */}
        {canSeePayslips ? <PayslipsCard employeeId={employeeId} /> : null}

        {employee.documents ? (
          <DocumentsCard
            employeeId={employee.id}
            documents={employee.documents}
            canManage={canEdit}
            onChanged={refresh}
          />
        ) : null}
      </div>

      {editing ? (
        <EditCardDialog
          employee={employee}
          title={editing}
          fields={CARD_FIELDS[editing] ?? []}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={refresh}
        />
      ) : null}

      <EditNameDialog
        employee={employee}
        open={editingName}
        onOpenChange={setEditingName}
        onSaved={refresh}
      />

      {/* Mounted only while open, so a second change starts from a blank form
          rather than the confirmation the last one ended on. */}
      {emailOpen ? (
        <HrChangeEmailDialog
          open={emailOpen}
          onOpenChange={setEmailOpen}
          employeeId={employee.id}
          employeeName={employee.work.fullName}
          currentEmail={employee.work.email}
          onChanged={refresh}
        />
      ) : null}

      <ExitDetailsDialog
        employee={employee}
        open={exitOpen}
        onOpenChange={setExitOpen}
        onSaved={refresh}
      />

      <SalaryStructureDialog
        employee={assigningStructure ? employee : null}
        structures={structuresQuery.data ?? []}
        pending={assignMutation.isPending}
        error={assignError}
        onOpenChange={(open) => !open && setAssigningStructure(false)}
        onSubmit={(salaryStructureId) => assignMutation.mutate(salaryStructureId)}
      />

      <ShiftDialog
        employee={assigningShift ? employee : null}
        shifts={shiftsQuery.data ?? []}
        pending={shiftMutation.isPending}
        error={shiftError}
        onOpenChange={(open) => !open && setAssigningShift(false)}
        onSubmit={(shiftId) => shiftMutation.mutate(shiftId)}
      />
    </>
  )
}
