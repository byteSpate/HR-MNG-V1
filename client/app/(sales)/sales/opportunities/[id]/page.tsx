import { OpportunityDetail } from "@/components/sales/opportunity-detail"

export default async function Page({ params }: PageProps<"/sales/opportunities/[id]">) {
  const { id } = await params
  return <OpportunityDetail opportunityId={id} />
}
