"use client"

/**
 * `/sales/tasks`: one list of follow-up tasks, filterable by status, by when
 * it is due, and by where it came from (revision §24.13).
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { RiArrowRightLine, RiFilterOffLine } from "@remixicon/react"

import { listTasks } from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type { ListTasksQuery, SalesTaskOrigin, SalesTaskStatus, SalesTaskSummary, TaskDueFilter } from "@/lib/api/types"
import type { TableCell } from "@/components/dashboard/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable, RowActions, TONE } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { taskActions } from "@/components/sales/shared/plan-panels"
import { TaskFormDialog, TaskStatusDialog, useTaskStatus } from "@/components/sales/tasks/task-dialogs"
import {
  TASK_ORIGIN_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  onDay,
} from "@/components/sales/shared/sales-shared"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const DUE_LABEL: Record<TaskDueFilter, string> = {
  overdue: "Overdue",
  today: "Due today",
  now: "Due today or overdue",
  week: "Due this week",
}
const STATUSES = Object.keys(TASK_STATUS_LABEL) as SalesTaskStatus[]
const DUES = Object.keys(DUE_LABEL) as TaskDueFilter[]
const ORIGINS = Object.keys(TASK_ORIGIN_LABEL) as SalesTaskOrigin[]
/** A select's "any", since an empty value reads as nothing chosen at all. */
const ANY = "any"

const TOGGLE_ON = "h-9 rounded-md bg-[#17191C] px-3 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const TOGGLE_OFF =
  "h-9 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"

export function TasksPage({
  initialDue,
  initialMine,
}: {
  initialDue: TaskDueFilter | null
  initialMine: boolean | null
}) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const router = useRouter()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  // Open tasks by default. A due filter from the overview already means
  // pending, so it starts on any status instead.
  const [status, setStatus] = useState<SalesTaskStatus | "">(initialDue ? "" : "PENDING")
  const [due, setDue] = useState<TaskDueFilter | "">(initialDue ?? "")
  const [origin, setOrigin] = useState<SalesTaskOrigin | "">("")
  const [mineChoice, setMine] = useState<boolean | null>(initialMine)
  const mine = mineChoice ?? !isSalesAdmin
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<SalesTaskSummary | null>(null)
  const [ending, setEnding] = useState<{ task: SalesTaskSummary; action: "DONE" | "CANCELLED" } | null>(null)
  const reopen = useTaskStatus()

  const filters: ListTasksQuery = useMemo(
    () => ({
      ...(status ? { status } : {}),
      ...(due ? { due } : {}),
      ...(origin ? { origin } : {}),
      ...(mine ? { mine: true } : {}),
    }),
    [status, due, origin, mine]
  )
  const query = useQuery({
    queryKey: salesKeys.tasks(filters as Record<string, unknown>),
    queryFn: () => listTasks(accessToken!, filters),
    enabled: isAuthed,
  })

  const isLoading = sessionStatus === "loading" || query.isPending
  const isFiltered = Boolean(status !== "PENDING" || due || origin)

  const rows: TableCell[][] = (query.data?.items ?? []).map((task) => [
    {
      node: (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="tabular-nums">{onDay(task.dueOn)}</span>
          {task.overdue ? <Tag label="Overdue" tone="red" /> : null}
        </span>
      ),
    },
    {
      node: (
        <span className="block min-w-0">
          <span className="block truncate font-semibold">{task.title}</span>
          {task.detail || task.opportunitySerial || task.meetingTitle ? (
            <span className={`block truncate text-[11.5px] ${TONE.muted}`}>
              {[task.opportunitySerial, task.meetingTitle, task.detail].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      node: task.salesAccountId ? (
        <Link href={`/sales/accounts/${task.salesAccountId}`} className="block truncate hover:underline">
          {task.salesAccountName}
        </Link>
      ) : (
        <span className={TONE.muted}>—</span>
      ),
    },
    { tag: TASK_PRIORITY_LABEL[task.priority], tone: TASK_PRIORITY_TONE[task.priority] },
    { tag: TASK_STATUS_LABEL[task.status], tone: TASK_STATUS_TONE[task.status] },
    { node: <span className="block truncate">{task.assignedToName}</span> },
    {
      node: (
        <RowActions
          actions={taskActions(task, {
            onDone: () => setEnding({ task, action: "DONE" }),
            onCancel: () => setEnding({ task, action: "CANCELLED" }),
            onEdit: () => setEditing(task),
            onReopen: () => reopen.mutate({ id: task.id, body: { status: "PENDING" } }),
          })}
        />
      ),
    },
  ])

  const clearFilters = () => {
    setStatus("PENDING")
    setDue("")
    setOrigin("")
    if (initialDue) router.replace("/sales/tasks")
  }

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Tasks"
        sub="Follow-ups you set yourself, each on an account. Anything due or overdue is in your 00:01 email."
        cta="New task"
        onCta={() => setCreateOpen(true)}
      />

      {/* Hidden while loading: a filter beside a skeleton reads as an answer
          about a list nobody has counted yet. */}
      {!isLoading && !query.isError ? (
        <section className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[#E4E9EF] bg-white p-3 sm:p-4">
          <Select value={status || ANY} onValueChange={(v) => setStatus(!v || v === ANY ? "" : (v as SalesTaskStatus))}>
            <SelectTrigger aria-label="Task status" className="h-9 w-auto min-w-[9rem]">
              <SelectValue>
                {(v: string | null) => (v && v !== ANY ? TASK_STATUS_LABEL[v as SalesTaskStatus] : "Any status")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={due || ANY} onValueChange={(v) => setDue(!v || v === ANY ? "" : (v as TaskDueFilter))}>
            <SelectTrigger aria-label="When it is due" className="h-9 w-auto min-w-[11rem]">
              <SelectValue>
                {(v: string | null) => (v && v !== ANY ? DUE_LABEL[v as TaskDueFilter] : "Any due date")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any due date</SelectItem>
              {DUES.map((d) => (
                <SelectItem key={d} value={d}>
                  {DUE_LABEL[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={origin || ANY} onValueChange={(v) => setOrigin(!v || v === ANY ? "" : (v as SalesTaskOrigin))}>
            <SelectTrigger aria-label="Where it came from" className="h-9 w-auto min-w-[9rem]">
              <SelectValue>
                {(v: string | null) => (v && v !== ANY ? TASK_ORIGIN_LABEL[v as SalesTaskOrigin] : "Any origin")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any origin</SelectItem>
              {ORIGINS.map((o) => (
                <SelectItem key={o} value={o}>
                  {TASK_ORIGIN_LABEL[o]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button type="button" aria-pressed={mine} onClick={() => setMine(!mine)} className={mine ? TOGGLE_ON : TOGGLE_OFF}>
            Mine only
          </Button>

          {isFiltered ? (
            <Button
              type="button"
              variant="link"
              onClick={clearFilters}
              className="h-9 gap-1.5 p-0 text-[12.5px] font-bold text-[#5F6B7C]"
            >
              <RiFilterOffLine className="size-3.5" aria-hidden />
              Clear
            </Button>
          ) : null}
        </section>
      ) : null}

      <PanelTable
        cols="auto minmax(0,1.6fr) minmax(0,1fr) auto auto minmax(0,0.8fr) auto"
        headers={["Due", "Task", "Account", "Priority", "Status", "Owner", ""]}
        rows={rows}
        isLoading={isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={isFiltered ? "Nothing matches these filters" : "No open tasks"}
        emptyBody={
          isFiltered
            ? "No task matches every filter at once. Widening one of them is usually enough."
            : "A task is one thing to do by a date, like calling back or sending a quote. Make one here, from an account, or from a deal's next step."
        }
        emptyAction={isFiltered ? "Clear filters" : "New task"}
        emptyActionIcon={isFiltered ? <RiArrowRightLine className="size-4" aria-hidden /> : undefined}
        onEmptyAction={isFiltered ? clearFilters : () => setCreateOpen(true)}
      />

      <TaskFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <TaskFormDialog
        open={!!editing}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        task={editing ?? undefined}
      />
      <TaskStatusDialog task={ending?.task ?? null} action={ending?.action ?? null} onClose={() => setEnding(null)} />
    </>
  )
}
