import { apiFetch } from "./client"
import type {
  CreateStaffAccountInput,
  CreateStaffAccountResult,
  DocumentItem,
  DocumentType,
  Employee,
  EmployeeInsights,
  EmployeeView,
  ExitReason,
  MyProfileResponse,
  SalesRole,
  SetSalesRoleResult,
  SignedDocumentUrl,
  UpdateEmployeeInput,
} from "./types"

export function listEmployees(accessToken: string): Promise<EmployeeView[]> {
  return apiFetch<EmployeeView[]>("/api/employees", { accessToken })
}

export function getEmployee(accessToken: string, id: string): Promise<EmployeeView> {
  return apiFetch<EmployeeView>(`/api/employees/${id}`, { accessToken })
}

export function getMyProfile(accessToken: string): Promise<MyProfileResponse> {
  return apiFetch<MyProfileResponse>("/api/employees/me", { accessToken })
}

export function getEmployeeInsights(
  accessToken: string,
  id: string
): Promise<EmployeeInsights> {
  return apiFetch<EmployeeInsights>(`/api/employees/${id}/insights`, { accessToken })
}

export function updateEmployee(
  accessToken: string,
  id: string,
  input: UpdateEmployeeInput
): Promise<EmployeeView> {
  return apiFetch<EmployeeView>(`/api/employees/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  })
}

/**
 * HR puts an employee on a band Finance authored. `null` un-assigns, and is
 * sent explicitly — an omitted key is a 400, not a silent un-assign.
 */
export function setSalaryStructure(
  accessToken: string,
  employeeId: string,
  salaryStructureId: string | null
): Promise<Employee> {
  return apiFetch<Employee>(`/api/employees/${employeeId}/salary-structure`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ salaryStructureId }),
  })
}

/**
 * Enables or disables the login behind an employee record.
 *
 * SUPER_ADMIN only on the server, so the UI gates on role before offering it.
 * Disabling revokes every refresh token that user holds. This is `isActive`
 * on the User row — not `employmentStatus`, which `setExitDetails` owns.
 */
export function setAccountActive(
  accessToken: string,
  employeeId: string,
  isActive: boolean
): Promise<{ id: string; accountActive: boolean }> {
  return apiFetch<{ id: string; accountActive: boolean }>(
    `/api/employees/${employeeId}/account`,
    {
      method: "PATCH",
      accessToken,
      body: JSON.stringify({ isActive }),
    }
  )
}

/**
 * Grants or revokes the Sales Hub capability attached to an employee's
 * login. HR/Super Admin only on the server — deliberately not requireSales,
 * so a Sales Admin cannot widen their own team. `null` revokes.
 */
export function setSalesRole(
  accessToken: string,
  employeeId: string,
  salesRole: SalesRole | null
): Promise<SetSalesRoleResult> {
  return apiFetch<SetSalesRoleResult>(`/api/employees/${employeeId}/sales-role`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ salesRole }),
  })
}

/**
 * HR-only, and deliberately separate from `PATCH /:id`: it asserts the month
 * is not locked, refuses once a settlement is approved, and derives
 * `employmentStatus` from the reason. Routing this through the general edit
 * would duplicate or bypass that logic.
 */
export function setExitDetails(
  accessToken: string,
  id: string,
  body: { lastWorkingDay: string; exitReason: ExitReason; exitNote?: string }
): Promise<void> {
  return apiFetch<void>(`/api/employees/${id}/exit`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function createStaffAccount(
  accessToken: string,
  input: CreateStaffAccountInput
): Promise<CreateStaffAccountResult> {
  return apiFetch<CreateStaffAccountResult>("/api/employees/staff", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

/**
 * Posts the file to our own API, which forwards it to the file store. The
 * client never talks to Cloudinary and never learns the cloud name.
 */
export function uploadDocument(
  accessToken: string,
  employeeId: string,
  file: File,
  type: DocumentType
): Promise<DocumentItem> {
  const form = new FormData()
  form.append("file", file)
  form.append("type", type)
  return apiFetch<DocumentItem>(`/api/employees/${employeeId}/documents`, {
    method: "POST",
    accessToken,
    body: form,
  })
}

export function getDocumentUrl(
  accessToken: string,
  employeeId: string,
  documentId: string
): Promise<SignedDocumentUrl> {
  return apiFetch<SignedDocumentUrl>(
    `/api/employees/${employeeId}/documents/${documentId}/url`,
    { accessToken }
  )
}

export function deleteDocument(
  accessToken: string,
  employeeId: string,
  documentId: string
): Promise<void> {
  return apiFetch<void>(`/api/employees/${employeeId}/documents/${documentId}`, {
    method: "DELETE",
    accessToken,
  })
}

export function uploadAvatar(
  accessToken: string,
  employeeId: string,
  file: File
): Promise<{ avatarUrl: string | null }> {
  const form = new FormData()
  form.append("file", file)
  return apiFetch<{ avatarUrl: string | null }>(`/api/employees/${employeeId}/avatar`, {
    method: "PATCH",
    accessToken,
    body: form,
  })
}

export function deleteAvatar(
  accessToken: string,
  employeeId: string
): Promise<{ avatarUrl: null }> {
  return apiFetch<{ avatarUrl: null }>(`/api/employees/${employeeId}/avatar`, {
    method: "DELETE",
    accessToken,
  })
}

/**
 * HR changing an employee's sign-in address. Applies immediately — there is
 * no old inbox to approve from, which is the whole reason this exists.
 */
export function changeEmployeeEmail(
  accessToken: string,
  employeeId: string,
  newEmail: string
): Promise<{ email: string; previousEmail: string; inviteResent: boolean }> {
  return apiFetch<{ email: string; previousEmail: string; inviteResent: boolean }>(
    `/api/employees/${employeeId}/email`,
    { method: "PATCH", accessToken, body: JSON.stringify({ newEmail }) }
  )
}

export function requestNationalIdChange(
  accessToken: string,
  newValue: string
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>("/api/employees/national-id-requests", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ newValue }),
  })
}

export function cancelNationalIdChangeRequest(
  accessToken: string,
  requestId: string
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/employees/national-id-requests/${requestId}/cancel`, {
    method: "PATCH",
    accessToken,
  })
}

export function approveNationalIdChangeRequest(
  accessToken: string,
  requestId: string
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/employees/national-id-requests/${requestId}/approve`, {
    method: "PATCH",
    accessToken,
  })
}

export function rejectNationalIdChangeRequest(
  accessToken: string,
  requestId: string,
  note: string
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/employees/national-id-requests/${requestId}/reject`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ note }),
  })
}
