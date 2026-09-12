import { OpportunitiesPage } from "@/components/sales/opportunities-page"

export default async function Page({ searchParams }: PageProps<"/sales/opportunities">) {
  const query = await searchParams
  const days = (value: string | string[] | undefined) => {
    const parsed = typeof value === "string" ? Number(value) : NaN
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 365 ? parsed : undefined
  }
  return <OpportunitiesPage actionFilters={{
    closing: days(query.closing), quiet: days(query.quiet), stuck: days(query.stuck),
    mine: query.mine === "true",
    ownerEmployeeId: typeof query.ownerEmployeeId === "string" ? query.ownerEmployeeId : undefined,
  }} />
}
