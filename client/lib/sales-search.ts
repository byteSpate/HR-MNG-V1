/**
 * The Accounts search (owner, 2026-11-10). The other Sales lists are searched
 * on the server because they are capped. Accounts is loaded whole, so it is
 * searched here, over the same fields a person would type: the name, the
 * industry and the owner. Case does not matter, the same as on the server.
 */
export function matchesAccount(
  account: { name: string; industry: string | null; ownerName: string },
  q: string
): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [account.name, account.industry ?? "", account.ownerName].some((field) => field.toLowerCase().includes(needle))
}
