import { apiFetch, apiFetchBlob } from "./client"
import type {
  AdjustmentInput,
  BankFileManifest,
  BankFileSummary,
  Currency,
  EmailStatus,
  ExchangeRate,
  ExchangeRateInput,
  PayrollAdjustment,
  PayrollRun,
  PayrollSettings,
  Payslip,
  SalaryStructure,
  SalaryStructureInput,
} from "./types"

// ── settings ──────────────────────────────────────────────────────────────

export function getPayrollSettings(accessToken: string): Promise<PayrollSettings> {
  return apiFetch<PayrollSettings>("/api/payroll/settings", { accessToken })
}

export function updatePayrollSettings(
  accessToken: string,
  input: Partial<PayrollSettings>
): Promise<PayrollSettings> {
  return apiFetch<PayrollSettings>("/api/payroll/settings", {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  })
}

// ── exchange rates ────────────────────────────────────────────────────────

export function listExchangeRates(accessToken: string): Promise<ExchangeRate[]> {
  return apiFetch<ExchangeRate[]>("/api/payroll/exchange-rates", { accessToken })
}

export function createExchangeRate(
  accessToken: string,
  input: ExchangeRateInput
): Promise<ExchangeRate> {
  return apiFetch<ExchangeRate>("/api/payroll/exchange-rates", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function updateExchangeRate(
  accessToken: string,
  id: string,
  input: ExchangeRateInput
): Promise<ExchangeRate> {
  return apiFetch<ExchangeRate>(`/api/payroll/exchange-rates/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  })
}

// ── salary structures ─────────────────────────────────────────────────────

export function listSalaryStructures(accessToken: string): Promise<SalaryStructure[]> {
  return apiFetch<SalaryStructure[]>("/api/payroll/salary-structures", { accessToken })
}

export function createSalaryStructure(
  accessToken: string,
  input: SalaryStructureInput
): Promise<SalaryStructure> {
  return apiFetch<SalaryStructure>("/api/payroll/salary-structures", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function updateSalaryStructure(
  accessToken: string,
  id: string,
  input: SalaryStructureInput
): Promise<SalaryStructure> {
  return apiFetch<SalaryStructure>(`/api/payroll/salary-structures/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  })
}

/**
 * A hard delete. Safe for history — payslips freeze their own figures and
 * hold no reference to a structure — but 409s while anyone is still assigned.
 */
export function deleteSalaryStructure(
  accessToken: string,
  id: string
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/payroll/salary-structures/${id}`, {
    method: "DELETE",
    accessToken,
  })
}

// ── runs ──────────────────────────────────────────────────────────────────

export function listPayrollRuns(accessToken: string): Promise<PayrollRun[]> {
  return apiFetch<PayrollRun[]>("/api/payroll/runs", { accessToken })
}

export function getPayrollRun(accessToken: string, id: string): Promise<PayrollRun> {
  return apiFetch<PayrollRun>(`/api/payroll/runs/${id}`, { accessToken })
}

// No `getPreflight`. `GET /runs/:id/preflight` exists, but `PayrollRun`
// already carries `preflight`, which is what `PreflightPanel` renders, so a
// second fetch for the same data had no caller and never will.

export function createPayrollRun(
  accessToken: string,
  input: { month: number; year: number; notes?: string }
): Promise<PayrollRun> {
  return apiFetch<PayrollRun>("/api/payroll/runs", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

const runAction = (action: string) => (accessToken: string, id: string) =>
  apiFetch<PayrollRun>(`/api/payroll/runs/${id}/${action}`, { method: "POST", accessToken })

/**
 * `excludedEmployeeIds` is the full list of people to leave out of this run.
 * Leave it out to keep the choice already saved on the run.
 */
export function processPayrollRun(
  accessToken: string,
  id: string,
  excludedEmployeeIds?: string[]
): Promise<PayrollRun> {
  return apiFetch<PayrollRun>(`/api/payroll/runs/${id}/process`, {
    method: "POST",
    accessToken,
    body: JSON.stringify(excludedEmployeeIds ? { excludedEmployeeIds } : {}),
  })
}

/** A draft run only. The server keeps a record and frees the month. */
export function deletePayrollRun(accessToken: string, id: string): Promise<unknown> {
  return apiFetch<unknown>(`/api/payroll/runs/${id}`, { method: "DELETE", accessToken })
}
export const submitPayrollRun = runAction("submit")
export const approvePayrollRun = runAction("approve")
export const disbursePayrollRun = runAction("disburse")

export function rejectPayrollRun(
  accessToken: string,
  id: string,
  note: string
): Promise<PayrollRun> {
  return apiFetch<PayrollRun>(`/api/payroll/runs/${id}/reject`, {
    method: "POST",
    accessToken,
    body: JSON.stringify({ note }),
  })
}

// ── payslips ──────────────────────────────────────────────────────────────

export function getMyPayslips(accessToken: string): Promise<Payslip[]> {
  return apiFetch<Payslip[]>("/api/payroll/payslips/me", { accessToken })
}

export function getEmployeePayslips(accessToken: string, employeeId: string): Promise<Payslip[]> {
  return apiFetch<Payslip[]>(`/api/payroll/payslips/employee/${employeeId}`, { accessToken })
}

export function getPayslip(accessToken: string, id: string): Promise<Payslip> {
  return apiFetch<Payslip>(`/api/payroll/payslips/${id}`, { accessToken })
}

/** The PDF is a blob, not JSON — see `apiFetchBlob`. */
export async function downloadPayslipPdf(accessToken: string, id: string): Promise<Blob> {
  const { blob } = await apiFetchBlob(`/api/payroll/payslips/${id}/pdf`, { accessToken })
  return blob
}

// ── adjustments ───────────────────────────────────────────────────────────

export function listAdjustments(
  accessToken: string,
  query: { month?: number; year?: number; employeeId?: string } = {}
): Promise<PayrollAdjustment[]> {
  const params = new URLSearchParams()
  if (query.month !== undefined) params.set("month", String(query.month))
  if (query.year !== undefined) params.set("year", String(query.year))
  if (query.employeeId) params.set("employeeId", query.employeeId)
  const qs = params.toString()
  return apiFetch<PayrollAdjustment[]>(`/api/payroll/adjustments${qs ? `?${qs}` : ""}`, {
    accessToken,
  })
}

export function createAdjustment(
  accessToken: string,
  input: AdjustmentInput
): Promise<PayrollAdjustment> {
  return apiFetch<PayrollAdjustment>("/api/payroll/adjustments", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  })
}

export function deleteAdjustment(accessToken: string, id: string): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/payroll/adjustments/${id}`, {
    method: "DELETE",
    accessToken,
  })
}

// ── bank files ────────────────────────────────────────────────────────────

/**
 * Returns the CSV *and* its manifest. The manifest rides in a response
 * header so a download still carries the completeness evidence — a file that
 * silently omitted every USD employee would otherwise look like success.
 */
export async function downloadBankFile(
  accessToken: string,
  runId: string,
  currency: Currency
): Promise<{ blob: Blob; manifest: BankFileManifest | null }> {
  const { blob, headers } = await apiFetchBlob(
    `/api/payroll/runs/${runId}/bank-file?currency=${currency}`,
    { accessToken }
  )
  const raw = headers.get("X-Bankfile-Manifest")
  return { blob, manifest: raw ? (JSON.parse(raw) as BankFileManifest) : null }
}

export function getBankFileSummary(accessToken: string, runId: string): Promise<BankFileSummary> {
  return apiFetch<BankFileSummary>(`/api/payroll/runs/${runId}/bank-file/summary`, { accessToken })
}

// ── email ─────────────────────────────────────────────────────────────────

export function emailPayslips(
  accessToken: string,
  runId: string
): Promise<{ queued: boolean; runId: string }> {
  return apiFetch<{ queued: boolean; runId: string }>(`/api/payroll/runs/${runId}/email`, {
    method: "POST",
    accessToken,
  })
}

export function getEmailStatus(accessToken: string, runId: string): Promise<EmailStatus> {
  return apiFetch<EmailStatus>(`/api/payroll/runs/${runId}/email-status`, { accessToken })
}
