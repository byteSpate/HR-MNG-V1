"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { getMyProfile } from "@/lib/api/employees"
import { useSession } from "@/lib/auth/session-context"
import type { EmployeeView } from "@/lib/api/types"
import { AccountProfile } from "@/components/profile/account-profile"
import { DocumentsCard } from "@/components/profile/documents-card"
import { EditMyDetailsDialog } from "@/components/profile/edit-my-details-dialog"
import { ProfileCard, formatDateValue } from "@/components/profile/profile-card"
import { ProfileHeader } from "@/components/profile/profile-header"
import { SessionsCard } from "@/components/profile/sessions-card"
import {
  PendingEmailChangeNotice,
  SignInEmailCard,
} from "@/components/profile/change-email-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EMPLOYMENT_TYPE_LABEL } from "@/components/profile/edit-card-dialog"

export function MyProfilePage() {
  const { accessToken, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)

  const profileQuery = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getMyProfile(accessToken!),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["my-profile"] })

  if (sessionStatus === "loading" || profileQuery.isPending) {
    return (
      <div className="space-y-3 pt-7">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (profileQuery.isError) {
    return (
      <div className="mt-7 rounded-md border border-[#E4E9EF] bg-white p-5.5 text-[13px] text-[#B03A3A]">
        Failed to load your profile.{" "}
        <Button variant="link" className="h-auto p-0 font-semibold underline" onClick={() => profileQuery.refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const { account, employee } = profileQuery.data

  return (
    <>
      {/* Above both branches: a change in flight is otherwise invisible, since
          the address on screen is still the old one until it completes. */}
      <PendingEmailChangeNotice />

      {/* The account branch carries its own header — the email is the heading
          there, and a generic "My Profile" above it was a second title saying
          less than the first. The staff branch still needs this one, since
          ProfileHeader opens on a name rather than a page title. */}
      {employee !== null ? (
        <div className="pt-7 pb-5.5">
          <div className="mb-1.5 text-[11.5px] font-bold tracking-[1.1px] text-[#5F6B7C] uppercase">
            Account
          </div>
          <h1 className="font-heading text-[23px] font-bold tracking-tight">My Profile</h1>
        </div>
      ) : (
        <div className="pt-7" />
      )}

      {employee === null ? (
        <AccountProfile account={account} onChanged={refresh} />
      ) : (
        <StaffProfile
          employee={employee}
          signInEmail={account.email}
          onRefresh={refresh}
          editOpen={editOpen}
          setEditOpen={setEditOpen}
        />
      )}
    </>
  )
}

function StaffProfile({
  employee,
  signInEmail,
  onRefresh,
  editOpen,
  setEditOpen,
}: {
  employee: EmployeeView
  /** From the account block, not the employee record — it lives on `User`. */
  signInEmail: string
  onRefresh: () => void
  editOpen: boolean
  setEditOpen: (open: boolean) => void
}) {
  const canEdit = employee.editableFields.length > 0

  return (
    <>
      <ProfileHeader
        employee={employee}
        avatarEditable={employee.editableFields.length > 0}
        onAvatarChanged={onRefresh}
        action={
          canEdit ? (
            <Button
              type="button"
              className="bg-[#17191C] text-white hover:bg-[#0E1012]"
              onClick={() => setEditOpen(true)}
            >
              Edit my details
            </Button>
          ) : null
        }
      />

      {/* Only blockers this person can actually resolve themselves. A blocker
          is shown if and only if the field it names is one the server said
          this caller may write — with the write matrix as it stands that is
          at most emergencyContact, and every other blocker is HR's work.
          Showing an employee a "payroll cannot process you" warning they are
          powerless to act on produces a support ticket and no fix. */}
      {(employee.blockers ?? [])
        .filter((blocker) => employee.editableFields.includes(blocker.field))
        .map((blocker) => (
          <div
            key={blocker.field}
            className="mb-4 flex items-center justify-between gap-3 rounded-md border border-[#E4E9EF] bg-[#F9FAFC] px-5 py-3.5"
          >
            <span className="text-[13px]">{blocker.blocks}</span>
            <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
              Add
            </Button>
          </div>
        ))}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(310px,1fr))] gap-4">
        {employee.personal ? (
          <ProfileCard
            title="Personal"
            lockedHint="Date of birth, gender and national ID are maintained by HR."
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
            rows={[
              {
                label: "Phone",
                value: employee.work.phone,
                hint: "Visible to colleagues in the staff directory",
              },
              { label: "Present address", value: employee.contact.presentAddress },
              { label: "Permanent address", value: employee.contact.permanentAddress },
              { label: "Emergency contact", value: employee.contact.emergencyContact },
            ]}
          />
        ) : null}

        {employee.employment ? (
          <ProfileCard
            title="Employment"
            lockedHint="Employment details are maintained by HR."
            rows={[
              { label: "Employee code", value: employee.employment.employeeCode },
              {
                label: "Employment type",
                value: EMPLOYMENT_TYPE_LABEL[employee.employment.employmentType] ?? null,
              },
              { label: "Joining date", value: formatDateValue(employee.employment.joiningDate) },
              { label: "Office location", value: employee.employment.officeLocation },
              {
                label: "Shift",
                // A dash read as "no shift", which is not what unset means:
                // an unassigned employee is judged against the General shift's
                // window. Matches the HR page.
                value: employee.employment.shift?.name ?? "General (default)",
                hint: "The working hours your attendance is judged against.",
              },
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
            lockedHint="Contact HR to update your bank details."
            rows={[
              {
                label: "Salary structure",
                value: employee.payroll.salaryStructure?.name ?? null,
              },
              { label: "Bank", value: employee.payroll.bankName },
              { label: "Account number", value: employee.payroll.bankAccountNumber },
              { label: "Routing number", value: employee.payroll.bankRoutingNumber },
            ]}
          />
        ) : null}

        {employee.documents ? (
          <DocumentsCard
            employeeId={employee.id}
            documents={employee.documents}
            footnote="Documents are uploaded by HR."
          />
        ) : null}

        {/* Rendered only when the person has actually left. An active employee
            should not see an empty card asking a question nobody posed. */}
        {employee.exit ? (
          <ProfileCard
            title="Exit"
            rows={[
              { label: "Last working day", value: formatDateValue(employee.exit.lastWorkingDay) },
              { label: "Reason", value: employee.exit.exitReason },
              { label: "Note", value: employee.exit.exitNote },
            ]}
            // The only card here that said nothing about why it cannot be
            // edited. Every other one does, and silence reads as an oversight
            // rather than as a rule.
            lockedHint="Recorded by HR. Speak to them if anything here is wrong."
          />
        ) : null}
      </div>

      {/* How you sign in, beside where you are signed in — the two questions
          belong together, and neither belongs among the contact details. */}
      <div className="mt-4">
        <SignInEmailCard email={signInEmail} />
      </div>

      {/* Every role, not only the administrative ones: "is somebody else in my
          account" is not a question that belongs to one kind of user. Outside
          the card grid because the rows are wide and read as a list. */}
      <div className="mt-4">
        <SessionsCard />
      </div>

      <EditMyDetailsDialog
        employee={employee}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={onRefresh}
      />
    </>
  )
}
