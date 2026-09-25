import { apiFetch } from "./client"
import type { VatCode } from "./types"

export interface CreateVatCodeInput {
  code: string
  name: string
  ratePercent: string
}

export interface UpdateVatCodeInput {
  name?: string
  ratePercent?: string
  isActive?: boolean
}

/** Active codes only, unless `all` — a code someone turned off still needs
 *  to be listed to edit it back on, or to read on an old document that used
 *  it before it was turned off. */
export function listVatCodes(accessToken: string, opts: { all?: boolean } = {}): Promise<VatCode[]> {
  const qs = opts.all ? "?all=true" : ""
  return apiFetch<VatCode[]>(`/api/vat-codes${qs}`, { accessToken })
}

export function createVatCode(accessToken: string, input: CreateVatCodeInput): Promise<VatCode> {
  return apiFetch<VatCode>("/api/vat-codes", { method: "POST", accessToken, body: JSON.stringify(input) })
}

/** A new rate is used for new lines only — an approved invoice or bill
 *  keeps its own frozen VAT amount. */
export function updateVatCode(accessToken: string, id: string, input: UpdateVatCodeInput): Promise<VatCode> {
  return apiFetch<VatCode>(`/api/vat-codes/${id}`, { method: "PATCH", accessToken, body: JSON.stringify(input) })
}
