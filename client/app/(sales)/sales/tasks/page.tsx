import { TasksPage } from "@/components/sales/tasks/tasks-page"
import type { TaskDueFilter } from "@/lib/api/types"

const DUE_FILTERS: TaskDueFilter[] = ["overdue", "today", "now", "week"]

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  // The overview's "Tasks due or overdue" row links here with due=now.
  const due = DUE_FILTERS.find((value) => value === query.due) ?? null
  const mine = query.mine === "true" ? true : query.mine === "false" ? false : null
  return <TasksPage initialDue={due} initialMine={mine} />
}
