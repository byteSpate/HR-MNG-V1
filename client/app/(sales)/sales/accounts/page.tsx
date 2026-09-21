import { AccountsPage } from "@/components/sales/accounts/accounts-page"

export default async function Page({ searchParams }: PageProps<"/sales/accounts">) {
  const query = await searchParams
  return <AccountsPage scope="all" filters={{
    unverified: query.unverified === "true",
    ownerEmployeeId: typeof query.ownerEmployeeId === "string" ? query.ownerEmployeeId : undefined,
  }} />
}
