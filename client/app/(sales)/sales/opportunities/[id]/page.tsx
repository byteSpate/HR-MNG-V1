import { OpportunityDetail } from "@/components/sales/opportunities/opportunity-detail"

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const query = await searchParams
  // The open tab lives in `?tab=`, so a link to an Opportunity can open the
  // tab the sender meant, and a link with no `?tab` still opens the first one.
  const tab = typeof query.tab === "string" ? query.tab : null
  return <OpportunityDetail opportunityId={id} initialTab={tab} />
}
