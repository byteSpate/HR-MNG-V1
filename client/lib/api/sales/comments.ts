import { apiFetch } from "../client"
import type {
  CreateSalesCommentBody,
  SalesCommentPage,
  SalesCommentSummary,
} from "../types"

export function listSalesComments(
  accessToken: string,
  entity: "SALES_ACCOUNT" | "OPPORTUNITY",
  entityId: string
): Promise<SalesCommentPage> {
  const search = new URLSearchParams({ entity, entityId })
  return apiFetch<SalesCommentPage>(`/api/sales/comments?${search.toString()}`, { accessToken })
}

export function createSalesComment(
  accessToken: string,
  body: CreateSalesCommentBody
): Promise<SalesCommentSummary> {
  return apiFetch<SalesCommentSummary>("/api/sales/comments", {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function updateSalesComment(
  accessToken: string,
  id: string,
  body: string
): Promise<SalesCommentSummary> {
  return apiFetch<SalesCommentSummary>(`/api/sales/comments/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ body }),
  })
}
