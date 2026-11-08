"use client"

import type { ReactNode } from "react"

import { deleteAvatar, uploadAvatar } from "@/lib/api/employees"
import { useSession } from "@/lib/auth/session-context"
import type { EmployeeView, EmploymentStatus } from "@/lib/api/types"
import { AvatarUpload } from "@/components/profile/avatar-upload"
import { formatDateValue } from "@/components/profile/profile-card"
import { Tag } from "@/components/dashboard/tag"
import type { Tone } from "@/components/dashboard/types"
import { Heading } from "@/components/ds/heading"

const STATUS_TONE: Record<EmploymentStatus, Tone> = {
  ACTIVE: "green",
  ON_LEAVE: "yellow",
  RESIGNED: "red",
  TERMINATED: "red",
}

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
}

/**
 * Reads only the payload. The `employment` group is optional because a
 * COLLEAGUE-tier view genuinely does not have one — the code and status lines
 * are omitted rather than faked.
 */
export function ProfileHeader({
  employee,
  avatarEditable,
  onAvatarChanged,
  onEditName,
  action,
}: {
  employee: EmployeeView
  avatarEditable: boolean
  onAvatarChanged: () => void
  /** Rendered only when supplied — the caller decides from editableFields. */
  onEditName?: () => void
  action?: ReactNode
}) {
  const { accessToken } = useSession()
  const employment = employee.employment
  return (
    <div className="mb-5 flex flex-wrap items-start gap-4 rounded-md border border-line bg-white px-5.5 py-5">
      <AvatarUpload
        upload={(file) => uploadAvatar(accessToken!, employee.id, file)}
        remove={() => deleteAvatar(accessToken!, employee.id)}
        avatarUrl={employee.work.avatarUrl}
        fullName={employee.work.fullName}
        editable={avatarEditable}
        onChanged={onAvatarChanged}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <Heading level="page">
            {employee.work.fullName}
          </Heading>
          {onEditName ? (
            <button
              type="button"
              onClick={onEditName}
              aria-label="Edit name"
              title="Edit name"
              className="rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
          ) : null}
          {employment ? (
            <Tag tone={STATUS_TONE[employment.employmentStatus]} label={STATUS_LABEL[employment.employmentStatus]} />
          ) : null}
          {/* Independent of employmentStatus — see EmploymentDetails.accountActive. */}
          {employment && !employment.accountActive ? <Tag tone="red" label="No access" /> : null}
        </div>
        <div className="mt-0.5 text-body-sm text-ink-muted">
          {employee.work.designation} · {employee.work.department.name}
        </div>
        {employment ? (
          <div className="mt-1 text-caption text-ink-muted">
            {employment.employeeCode} · Joined {formatDateValue(employment.joiningDate)}
          </div>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  )
}
