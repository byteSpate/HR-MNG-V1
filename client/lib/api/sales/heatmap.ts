import { apiFetch } from "../client"
import type { AccountHeatmap, HeatmapItemBody, HeatmapNeed } from "../types"

/** The account's Heatmap tab: every card, its need, its items and its colour. Every write returns all of it. */
export function getAccountHeatmap(accessToken: string, accountId: string): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap`, { accessToken })
}

export function setHeatmapNeed(
  accessToken: string,
  accountId: string,
  card: string,
  body: { need: HeatmapNeed; reason: string | null }
): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap/${card}/need`, {
    method: "PUT",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function addHeatmapItem(
  accessToken: string,
  accountId: string,
  card: string,
  body: HeatmapItemBody
): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap/${card}/items`, {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function updateHeatmapItem(
  accessToken: string,
  accountId: string,
  itemId: string,
  body: HeatmapItemBody
): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap/items/${itemId}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(body),
  })
}

export function removeHeatmapItem(accessToken: string, accountId: string, itemId: string): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap/items/${itemId}`, {
    method: "DELETE",
    accessToken,
  })
}
