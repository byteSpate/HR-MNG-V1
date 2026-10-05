"use client"

import { useQuery } from "@tanstack/react-query"

import { getMySalesPermissions } from "@/lib/api/sales/permissions"
import { salesKeys } from "@/lib/api/sales/keys"
import type { SalesPermissionKey } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { permissionAllows } from "./permission-state"

/**
 * What the signed-in person may do in the Sales Hub right now.
 *
 * A Sales Admin and the Super Admin are never asked: they may do everything.
 * Everyone else reads `GET /api/sales/permissions/me` once, and again when the
 * window regains focus, so a switch an admin just changed shows up without a
 * reload. This hides or disables buttons. It is not access control.
 */
export function useSalesPermissions() {
  const { accessToken, status, user } = useSession()
  const isAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")
  const query = useQuery({
    queryKey: salesKeys.myPermissions(),
    queryFn: () => getMySalesPermissions(accessToken!),
    enabled: status === "authenticated" && !!accessToken && !isAdmin && !!user?.salesRole,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  return {
    can: (key: SalesPermissionKey) => permissionAllows({ isAdmin, permissions: query.data?.permissions, key }),
    /** False until the first answer, for a Sales User. A Sales Admin is ready at once. */
    ready: isAdmin || query.isSuccess,
  }
}
