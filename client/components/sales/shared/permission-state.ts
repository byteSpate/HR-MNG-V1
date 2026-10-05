import type { SalesPermissionKey } from "@/lib/api/types"

/**
 * Whether a button for this action should be live. For looks only: the server
 * refuses the action either way. Until the answer arrives nothing is allowed,
 * so a button never flashes on and then off.
 */
export function permissionAllows(args: {
  isAdmin: boolean
  permissions: Partial<Record<SalesPermissionKey, boolean>> | undefined
  key: SalesPermissionKey
}): boolean {
  if (args.isAdmin) return true
  return args.permissions?.[args.key] === true
}

/** Said beside a control that is switched off. Same sentence as the server's. */
export const SWITCHED_OFF_HINT = "A Sales Admin has turned this off for Sales Users."
