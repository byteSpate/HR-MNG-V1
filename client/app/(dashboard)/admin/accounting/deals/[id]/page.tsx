import { DealMoneyPage } from "@/components/accounting/deal-money-page"

export default async function Page({ params }: PageProps<"/admin/accounting/deals/[id]">) {
  const { id } = await params
  return <DealMoneyPage opportunityId={id} />
}
