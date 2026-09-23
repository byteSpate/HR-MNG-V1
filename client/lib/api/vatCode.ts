import { apiFetch } from "./client"
import type { VatCode } from "./types"

export function listVatCodes(accessToken: string): Promise<VatCode[]> {
  return apiFetch<VatCode[]>("/api/vat-codes", { accessToken })
}
