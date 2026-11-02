"use client"

/**
 * One person's week on the Saturday page (owner, 2026-11-02): what they did and
 * planned from Sunday to Thursday, how it splits by type, and their take-outs.
 * It is above the funnel, so an admin sees the week and the pipeline together,
 * and does not have to visit the Tasks page to learn what the person did.
 */

import { useQuery } from "@tanstack/react-query"

import { getPersonWeek } from "@/lib/api/sales/funnel"
import { funnelKeys } from "@/lib/api/sales/funnel-keys"
import { useSession } from "@/lib/auth/session-context"
import type { PersonWeek, SalesTaskSummary, SalesTaskType } from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { TakeOutBox } from "@/components/sales/funnel/take-out-box"
import { onDay, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/components/sales/shared/sales-shared"
import { TASK_TYPE_LABEL, TASK_TYPES } from "@/components/sales/shared/task-types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

function TaskLine({ task }: { task: SalesTaskSummary }) {
  const about = [task.salesAccountName, task.opportunitySerial].filter(Boolean).join(" · ")
  const given = task.givenByName ? `Take-out from ${task.givenByName}${task.givenOn ? `, ${onDay(task.givenOn)}` : ""}` : null
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[#EFF2F6] px-3 py-2 first:border-t-0">
      <span className="min-w-0 flex-1 basis-56">
        <span className="block text-[12.5px] font-semibold [overflow-wrap:anywhere]">{task.title}</span>
        {about || given ? (
          <span className={cn("block text-[11.5px] [overflow-wrap:anywhere]", TONE.muted)}>{[about, given].filter(Boolean).join(" · ")}</span>
        ) : null}
      </span>
      <Tag label={TASK_TYPE_LABEL[task.type]} tone="neutral" />
      <Tag label={TASK_STATUS_LABEL[task.status]} tone={TASK_STATUS_TONE[task.status]} />
    </li>
  )
}

function TakeOutLines({ title, items, empty }: { title: string; items: SalesTaskSummary[]; empty: string }) {
  return (
    <div>
      <h4 className="mb-1 text-[12px] font-bold text-[#17191C]">
        {title} <span className={cn("font-semibold", TONE.muted)}>{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className={cn("text-[12px]", TONE.muted)}>{empty}</p>
      ) : (
        <ul className="overflow-hidden rounded-md border border-[#E4E9EF] bg-white">
          {items.map((task) => (
            <li key={task.id} className="flex flex-wrap items-baseline gap-x-2 border-t border-[#EFF2F6] px-3 py-2 first:border-t-0">
              <span className="min-w-0 flex-1 basis-56 text-[12.5px] font-semibold [overflow-wrap:anywhere]">{task.title}</span>
              <span className={cn("text-[11.5px]", TONE.muted)}>
                {task.opportunitySerial ? `${task.opportunitySerial} · ` : ""}
                {task.givenByName ? `${task.givenByName}, ${task.givenOn ? onDay(task.givenOn) : ""}` : ""}
                {task.status === "PENDING" ? ` · due ${onDay(task.dueOn)}` : ""}
              </span>
              {task.overdue ? <Tag label="Overdue" tone="red" /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The same shape as the loaded week (a heading line, five day rows), so the
 * page does not jump when the data arrives. Quiet: the shared Skeleton pulses
 * already and nothing else moves.
 */
function PersonWeekSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading this person's week"
      className="space-y-4 rounded-lg border border-[#E4E9EF] bg-white px-4 py-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3.5 w-32" />
      </div>
      <div className="space-y-2.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  )
}

export function PersonWeekPanel({
  employeeId,
  isAdmin,
}: {
  employeeId: string
  /** Only a Sales Admin writes a take-out. */
  isAdmin: boolean
}) {
  const { accessToken, status } = useSession()
  const query = useQuery({
    queryKey: funnelKeys.week(employeeId),
    queryFn: () => getPersonWeek({ employeeId }, accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  })

  if (query.isError) {
    return (
      <div className="grid gap-2">
        <PanelAlert>{toMessage(query.error)}</PanelAlert>
        <div>
          <Button type="button" onClick={() => query.refetch()} className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]">
            Try again
          </Button>
        </div>
      </div>
    )
  }
  if (query.isPending) return <PersonWeekSkeleton />

  const week: PersonWeek = query.data
  const total = Object.values(week.countsByType).reduce((a, b) => a + b, 0)

  return (
    <section aria-label={`${week.employee.fullName}'s week`} className="space-y-4 rounded-lg border border-[#E4E9EF] bg-white px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-heading text-[14px] font-bold tracking-tight">This week</h3>
        <span className={cn("text-[12px] tabular-nums", TONE.muted)}>Week of {onDay(week.weekStart)}</span>
      </div>

      {total === 0 ? (
        <p className={cn("text-[12.5px]", TONE.muted)}>
          Nothing was recorded for {week.employee.fullName} this week. Tasks and I did this entries show here.
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2" aria-label="Work by type">
            {TASK_TYPES.filter((type: SalesTaskType) => week.countsByType[type] > 0).map((type) => (
              <li key={type} className="rounded-full border border-[#E4E9EF] bg-[#F8FAFC] px-3 py-1 text-[12px] font-semibold">
                {TASK_TYPE_LABEL[type]} <span className="tabular-nums">{week.countsByType[type]}</span>
              </li>
            ))}
          </ul>
          <div className="grid gap-2">
            {week.days.map((day) => (
              <section key={day.date} aria-label={day.label} className="overflow-hidden rounded-md border border-[#E4E9EF]">
                <h4 className="flex items-baseline justify-between bg-[#F8FAFC] px-3 py-1.5 text-[12px] font-bold">
                  <span>{day.label}</span>
                  <span className={cn("font-semibold tabular-nums", TONE.muted)}>{onDay(day.date)}</span>
                </h4>
                {day.tasks.length === 0 ? (
                  <p className={cn("px-3 py-2 text-[12px]", TONE.muted)}>Nothing recorded.</p>
                ) : (
                  <ul>
                    {day.tasks.map((task) => (
                      <TaskLine key={task.id} task={task} />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </>
      )}

      <div className="grid gap-3 border-t border-[#EFF2F6] pt-3">
        <h3 className="font-heading text-[14px] font-bold tracking-tight">Take-outs</h3>
        <TakeOutLines title="Open" items={week.takeOuts.open} empty="No open take-outs." />
        <TakeOutLines title="Done this week" items={week.takeOuts.doneThisWeek} empty="None finished this week." />
        {isAdmin ? <TakeOutBox employeeId={week.employee.id} employeeName={week.employee.fullName} /> : null}
      </div>
    </section>
  )
}
