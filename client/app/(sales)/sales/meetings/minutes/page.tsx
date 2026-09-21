import { MinutesListPage } from "@/components/sales/minutes/minutes-list-page"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  // The overview links here with mine=true. Absent leaves the page's own default.
  const mine = query.mine === "true" ? true : query.mine === "false" ? false : null
  return <MinutesListPage initialMine={mine} />
}
