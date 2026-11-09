"use client"

/**
 * The Logs tab on the Tasks page (owner, 2026-11-02): all the work the person
 * has done, with or without an account, day by day for one week. An account or
 * Opportunity shows as a small line under the title. A done task counts for the
 * day it was done, not the day it was planned.
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
import { TaskFormDialog } from "@/components/sales/tasks/task-dialogs"
import { logDaySlots, shiftWeek, weekLabel, weekRange, weekStartOf } from "@/components/sales/tasks/logs-days"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Heading } from "@/components/ds/heading"

/** A select's "any", since an empty value reads as nothing chosen at all. */
const ANY = "any"
const ME = "me"

const todayInput = () => new Date().toLocaleDateString("en-CA")

function LogRow({ task, onEdit }: { task: SalesTaskSummary; onEdit: () => void }) {
  const about = [task.salesAccountName, task.opportunitySerial].filter(Boolean).join(" · ")
  const given = task.givenByName ? `Take-out from ${task.givenByName}${task.givenOn ? `, ${onDay(task.givenOn)}` : ""}` : null
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-surface-sunken px-4 py-2.5 first:border-t-0">
      <span className="min-w-0 flex-1 basis-60">
        <span className="block text-body-sm font-semibold [overflow-wrap:anywhere]">{task.title}</span>
        {about || given || task.detail ? (
          <span className={`block text-caption ${TONE.muted} [overflow-wrap:anywhere]`}>
            {[about, given, task.detail].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </span>
      <Tag label={TASK_TYPE_LABEL[task.type]} tone="neutral" />
      <Tag label={TASK_STATUS_LABEL[task.status]} tone={TASK_STATUS_TONE[task.status]} />
      {task.canManage ? (
        <Button type="button" variant="outline" onClick={onEdit} className="h-auto rounded-md px-3 py-1.5 text-caption font-bold">
          Edit
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
  const [editing, setEditing] = useState<SalesTaskSummary | null>(null)

  // Only a Sales Admin can read another person's log, so only they get the picker.
  const people = useQuery({
    queryKey: ["sales", "log-people"],
    queryFn: () => listMeetingAttendeeOptions(accessToken!),
    enabled: isAuthed && isSalesAdmin,
  })

  const filters: ListTasksQuery = useMemo(
    () => ({
      status: "DONE",
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
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-white p-3 sm:p-4">
        <Button type="button" variant="outline" aria-label="Earlier week" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} className="h-9 px-2">
          <RiArrowLeftSLine className="size-4" aria-hidden />
        </Button>
        <span className="min-w-[10rem] text-center text-body-sm font-bold tabular-nums">{weekLabel(weekStart)}</span>
        <Button type="button" variant="outline" aria-label="Later week" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} className="h-9 px-2">
          <RiArrowRightSLine className="size-4" aria-hidden />
        </Button>
        {weekStart !== thisWeek ? (
          <Button type="button" variant="link" onClick={() => setWeekStart(thisWeek)} className="h-9 p-0 text-caption font-bold text-ink-muted">
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
            <Button type="button" onClick={() => query.refetch()} className="h-8 rounded-md bg-ink px-3 text-caption font-bold text-white hover:bg-ink-strong">
              Try again
            </Button>
          </div>
        </div>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <p className={`rounded-md border border-line bg-white px-4 py-4 text-caption ${TONE.muted}`}>
          {ownLog && !isSalesAdmin
            ? "Nothing logged this week yet. Press I did this to record work you have done."
            : "Nothing logged for this person this week."}
        </p>
      ) : (
        <div className="grid gap-3">
          {slots.map((slot) => (
            <section key={slot.date} aria-label={slot.label} className="overflow-hidden rounded-md border border-line bg-white">
              <Heading level="card" className="flex items-baseline justify-between gap-2 bg-surface-subtle px-4 py-2">
                <span>{slot.label}</span>
                <span className={`font-semibold tabular-nums ${TONE.muted}`}>{onDay(slot.date)}</span>
              </Heading>
              {slot.tasks.length === 0 ? (
                <p className={`px-4 py-2.5 text-caption ${TONE.muted}`}>Nothing logged.</p>
              ) : (
                <ul>
                  {slot.tasks.map((task) => (
                    <LogRow
                      key={task.id}
                      task={task}
                      onEdit={() => setEditing(task)}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
      <TaskFormDialog
        open={!!editing}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        task={editing ?? undefined}
      />
    </section>
  )
}
