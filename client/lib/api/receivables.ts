import { apiFetch, apiFetchBlob } from "./client"
import type { CustomerAgeingRow, CustomerStatement, CustomerTieOut } from "./types"

export function getCustomerAgeing(accessToken: string): Promise<CustomerAgeingRow[]> {
  return apiFetch<CustomerAgeingRow[]>("/api/receivables/reports/ageing", { accessToken })
}

export function getCustomerTieOut(accessToken: string): Promise<CustomerTieOut> {
  return apiFetch<CustomerTieOut>("/api/receivables/reports/tie-out", { accessToken })
}

export function getCustomerStatement(
  accessToken: string,
  customerId: string,
  range: { from: string; to: string }
): Promise<CustomerStatement> {
  return apiFetch<CustomerStatement>(
    `/api/receivables/customers/${customerId}/statement?from=${range.from}&to=${range.to}`,
    { accessToken }
  )
}

export async function downloadCustomerStatementPdf(
  accessToken: string,
  customerId: string,
  range: { from: string; to: string }
): Promise<Blob> {
  const { blob } = await apiFetchBlob(
    `/api/receivables/customers/${customerId}/statement.pdf?from=${range.from}&to=${range.to}`,
    { accessToken }
  )
  return blob
}
