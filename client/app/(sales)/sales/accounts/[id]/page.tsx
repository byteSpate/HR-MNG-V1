import { AccountDetail } from "@/components/sales/account-detail"

export default async function Page({ params }: PageProps<"/sales/accounts/[id]">) {
  const { id } = await params
  return <AccountDetail accountId={id} />
}
