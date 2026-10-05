import { apiFetch } from "../client"
import type {
  SalesPermissionHistoryRow,
  SalesPermissionKey,
  SalesPermissionRow,
  SaveSalesPermissionsBody,
} from "../types"

/** The newest 50 switch changes. Open to the whole hub. */
export function listSalesPermissionHistory(accessToken: string): Promise<{ items: SalesPermissionHistoryRow[] }> {
  return apiFetch<{ items: SalesPermissionHistoryRow[] }>("/api/sales/permissions/history", { accessToken })
}

/** Every switch with its value and who last changed it. Open to the whole hub. */
export function listSalesPermissions(accessToken: string): Promise<{ items: SalesPermissionRow[] }> {
  return apiFetch<{ items: SalesPermissionRow[] }>("/api/sales/permissions", { accessToken })
}

/** The caller's own answers. Used to hide a button that would be refused. */
export function getMySalesPermissions(
  accessToken: string
): Promise<{ permissions: Record<SalesPermissionKey, boolean> }> {
  return apiFetch<{ permissions: Record<SalesPermissionKey, boolean> }>("/api/sales/permissions/me", { accessToken })
}

/** Sales Admin only. The server refuses the whole batch if one key is wrong. */
export function saveSalesPermissions(
  accessToken: string,
  body: SaveSalesPermissionsBody
): Promise<{ items: SalesPermissionRow[] }> {
  return apiFetch<{ items: SalesPermissionRow[] }>("/api/sales/permissions", {
    method: "PUT",
    accessToken,
    body: JSON.stringify(body),
  })
}
