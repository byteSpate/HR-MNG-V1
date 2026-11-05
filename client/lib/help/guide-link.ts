/**
 * Where the accounting guide lives for the person looking at a page.
 *
 * The guide page exists only in the Admin and Finance areas
 * (`/admin/accounting/guide`, `/finance/accounting/guide`). HR, Managers and
 * Employees have no such page, so a link for them would open a 404. They get
 * `null`, and the caller shows no link at all.
 */
const AREAS_WITH_A_GUIDE = new Set(["admin", "finance"])

export function guideHrefFor(pathname: string, stepId: string | undefined): string | null {
  const first = pathname.split("/").filter(Boolean)[0]
  if (!first || !AREAS_WITH_A_GUIDE.has(first)) return null
  return `/${first}/accounting/guide#${stepId ?? "setup"}`
}
