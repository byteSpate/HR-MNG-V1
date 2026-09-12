import { AccountsPage } from "@/components/sales/accounts-page"

export default async function Page({ searchParams }: PageProps<"/sales/my-accounts">) {
  const query = await searchParams
  return <AccountsPage scope="mine" filters={{ unverified: query.unverified === "true" }} />
}
