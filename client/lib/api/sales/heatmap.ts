import { apiFetch } from "../client"
import type { AccountHeatmap, HeatmapList, HeatmapListLevel } from "../types"

/** The account's Heatmap tab. Every write returns all of it. */
export function getAccountHeatmap(accessToken: string, accountId: string): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap`, { accessToken })
}

/** GREEN is a tick, RED is a cross, NONE clears it back to not checked. */
export type HeatmapMarkBody = "GREEN" | "RED" | "NONE"

/** One part. */
export function setPartMark(accessToken: string, accountId: string, partId: string, mark: HeatmapMarkBody): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap/parts/${partId}/mark`, {
    method: "PUT",
    accessToken,
    body: JSON.stringify({ mark }),
  })
}

/** Every shown part of a product at once: "All ticks", "All crosses", or clear all. */
export function setProductMarks(accessToken: string, accountId: string, productId: string, mark: HeatmapMarkBody): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap/products/${productId}/marks`, {
    method: "PUT",
    accessToken,
    body: JSON.stringify({ mark }),
  })
}

/** The optional note on a Red product. An empty note removes it. */
export function setProductNote(accessToken: string, accountId: string, productId: string, note: string | null): Promise<AccountHeatmap> {
  return apiFetch<AccountHeatmap>(`/api/sales/accounts/${accountId}/heatmap/products/${productId}/note`, {
    method: "PUT",
    accessToken,
    body: JSON.stringify({ note }),
  })
}

// The list, in Sales Settings (Sales Admins). Every write returns all of it.
const LIST = "/api/sales/settings/heatmap-list"

export function getHeatmapList(accessToken: string): Promise<HeatmapList> {
  return apiFetch<HeatmapList>(LIST, { accessToken })
}

export function addHeatmapListRow(
  accessToken: string,
  level: HeatmapListLevel,
  parentId: string | null,
  body: { title: string; note?: string | null }
): Promise<HeatmapList> {
  const path =
    level === "groups" ? `${LIST}/groups` : level === "products" ? `${LIST}/groups/${parentId}/products` : `${LIST}/products/${parentId}/parts`
  return apiFetch<HeatmapList>(path, { method: "POST", accessToken, body: JSON.stringify(body) })
}

export function editHeatmapListRow(
  accessToken: string,
  level: HeatmapListLevel,
  id: string,
  body: { title?: string; note?: string | null; hidden?: boolean }
): Promise<HeatmapList> {
  return apiFetch<HeatmapList>(`${LIST}/${level}/${id}`, { method: "PATCH", accessToken, body: JSON.stringify(body) })
}

export function moveHeatmapListRow(accessToken: string, level: HeatmapListLevel, id: string, direction: "UP" | "DOWN"): Promise<HeatmapList> {
  return apiFetch<HeatmapList>(`${LIST}/${level}/${id}/move`, { method: "POST", accessToken, body: JSON.stringify({ direction }) })
}

export function deleteHeatmapListRow(accessToken: string, level: HeatmapListLevel, id: string): Promise<HeatmapList> {
  return apiFetch<HeatmapList>(`${LIST}/${level}/${id}`, { method: "DELETE", accessToken })
}
