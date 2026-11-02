"use client"

/**
 * The Logs tab on the Tasks page (owner, 2026-11-02): the person's tasks that
 * belong to no account, day by day for one week. This is where learning, office
 * work and any other work that is not about an account is kept, next to the
 * take-outs an admin gave them.
 *
 * Tasks that have an account stay where they are: on the account's Timeline,
 * on the Opportunity, and in the Tasks list.
 */

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiArrowLeftSLine, RiArrowRightSLine } from "@remixicon/react"

import { listMeetingAttendeeOptions } from "@/lib/api/sales/meetings"
import { salesKeys } from "@/lib/api/sales/keys"
import { listTasks } from "@/lib/api/sales/tasks"
import { useSession } from "@/lib/auth/session-context"
import type { ListTasksQuery, SalesTaskSummary, SalesTaskType } from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { onDay, TASK_STATUS_LABEL, TASK_STATUS_TONE } from "@/components/sales/shared/sales-shared"
import { TASK_TYPE_LABEL, TASK_TYPES } from "@/components/sales/shared/task-types"
import { useTaskStatus } from "@/components/sales/tasks/task-dialogs"
import { logDaySlots, shiftWeek, weekLabel, weekRange, weekStartOf } from "@/components/sales/tasks/logs-days"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

/** A select's "any", since an empty value reads as nothing chosen at all. */
const ANY = "any"
const ME = "me"

const todayInput = () => new Date().toLocaleDateString("en-CA")

function LogRow({ task, onDone, busy }: { task: SalesTaskSummary; onDone: () => void; busy: boolean }) {
  const given = task.givenByName ? `Take-out from ${task.givenByName}${task.givenOn ? `, ${onDay(task.givenOn)}` : ""}` : null
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[#EFF2F6] px-4 py-2.5 first:border-t-0">
      <span className="min-w-0 flex-1 basis-60">
        <span className="block text-[13px] font-semibold [overflow-wrap:anywhere]">{task.title}</span>
        {given || task.detail ? (
          <span className={`block text-[11.5px] ${TONE.muted} [overflow-wrap:anywhere]`}>
            {[given, task.detail].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
      <Tag label={TASK_TYPE_LABEL[task.type]} tone="neutral" />
      <Tag label={TASK_STATUS_LABEL[task.status]} tone={TASK_STATUS_TONE[task.status]} />
      {task.status === "PENDING" && task.canManage ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onDone}
          className="h-auto rounded-md px-3 py-1.5 text-[12px] font-bold"
        >
          Mark done
        </Button>
      ) : null}
    </li>
  )
}

export function LogsPanel({ isSalesAdmin }: { isSalesAdmin: boolean }) {
  const { accessToken, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken

  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayInput()))
  const [type, setType] = useState<SalesTaskType | "">("")
  const [person, setPerson] = useState(ME)
  const finish = useTaskStatus()

  // Only a Sales Admin can read another person's log, so only they get the picker.
  const people = useQuery({
    queryKey: ["sales", "log-people"],
    queryFn: () => listMeetingAttendeeOptions(accessToken!),
    enabled: isAuthed && isSalesAdmin,
  })

  const filters: ListTasksQuery = useMemo(
    () => ({
      noAccount: true,
      ...weekRange(weekStart),
      ...(type ? { type } : {}),
      ...(person === ME ? { mine: true } : { assignedToEmployeeId: person }),
    }),
    [weekStart, type, person]
  )
  const query = useQuery({
    queryKey: salesKeys.tasks({ ...filters, view: "logs" } as Record<string, unknown>),
    queryFn: () => listTasks(accessToken!, filters),
    enabled: isAuthed,
  })

  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const slots = useMemo(() => logDaySlots(weekStart, items), [weekStart, items])
  const thisWeek = weekStartOf(todayInput())
  const isLoading = sessionStatus === "loading" || query.isPending
  const ownLog = person === ME

  return (
    <section aria-label="Logs" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#E4E9EF] bg-white p-3 sm:p-4">
        <Button type="button" variant="outline" aria-label="Earlier week" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} className="h-9 px-2">
          <RiArrowLeftSLine className="size-4" aria-hidden />
        </Button>
        <span className="min-w-[10rem] text-center text-[13px] font-bold tabular-nums">{weekLabel(weekStart)}</span>
        <Button type="button" variant="outline" aria-label="Later week" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} className="h-9 px-2">
          <RiArrowRightSLine className="size-4" aria-hidden />
        </Button>
        {weekStart !== thisWeek ? (
          <Button type="button" variant="link" onClick={() => setWeekStart(thisWeek)} className="h-9 p-0 text-[12.5px] font-bold text-[#5F6B7C]">
            This week
          </Button>
        ) : null}

        <Select value={type || ANY} onValueChange={(v) => setType(!v || v === ANY ? "" : (v as SalesTaskType))}>
          <SelectTrigger aria-label="Type of work" className="h-9 w-auto min-w-[9rem]">
            <SelectValue>{(v: string | null) => (v && v !== ANY ? TASK_TYPE_LABEL[v as SalesTaskType] : "Any type")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any type</SelectItem>
            {TASK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TASK_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isSalesAdmin && people.data ? (
          <Select value={person} onValueChange={(v) => v && setPerson(v)}>
            <SelectTrigger aria-label="Whose log" className="h-9 w-auto min-w-[10rem]">
              <SelectValue>
                {(v: string | null) => (v && v !== ME ? (people.data.find((p) => p.id === v)?.fullName ?? "A person") : "My log")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ME}>My log</SelectItem>
              {people.data.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {query.isError ? (
        <div className="grid gap-2">
          <PanelAlert>{toMessage(query.error)}</PanelAlert>
          <div>
            <Button type="button" onClick={() => query.refetch()} className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]">
              Try again
            </Button>
          </div>
        </div>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <p className={`rounded-md border border-[#E4E9EF] bg-white px-4 py-4 text-[12.5px] ${TONE.muted}`}>
          {ownLog && !isSalesAdmin
            ? "Nothing logged this week yet. Press I did this to add work that is not about an account, like learning or office work."
            : "Nothing logged for this person this week."}
        </p>
      ) : (
        <div className="grid gap-3">
          {slots.map((slot) => (
            <section key={slot.date} aria-label={slot.label} className="overflow-hidden rounded-md border border-[#E4E9EF] bg-white">
              <h3 className="flex items-baseline justify-between gap-2 bg-[#F8FAFC] px-4 py-2 text-[12.5px] font-bold">
                <span>{slot.label}</span>
                <span className={`font-semibold tabular-nums ${TONE.muted}`}>{onDay(slot.date)}</span>
              </h3>
              {slot.tasks.length === 0 ? (
                <p className={`px-4 py-2.5 text-[12px] ${TONE.muted}`}>Nothing logged.</p>
              ) : (
                <ul>
                  {slot.tasks.map((task) => (
                    <LogRow
                      key={task.id}
                      task={task}
                      busy={finish.isPending}
                      onDone={() => finish.mutate({ id: task.id, body: { status: "DONE" } })}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
