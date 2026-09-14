"use client"

/**
 * The Meetings and Tasks panels on an account page and a deal page, and the
 * rows the two list pages share with them. They sit in the left column, the
 * side you act on (revision §23, page layout).
 */

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  RiArrowGoBackLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiRefreshLine,
} from "@remixicon/react"

import { listMeetings, listTasks } from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type { SalesMeetingSummary, SalesTaskSummary } from "@/lib/api/types"
import { Tag } from "@/components/dashboard/tag"
import { RowActions, type RowAction } from "@/components/dashboard/record-kit"
import { MeetingFormDialog, MeetingStatusDialog, useMeetingStatus } from "@/components/sales/meeting-dialogs"
import { TaskFormDialog, TaskStatusDialog, useTaskStatus } from "@/components/sales/task-dialogs"
import {
  MEETING_ICON,
  MEETING_MODE_LABEL,
  MEETING_STATUS_LABEL,
  MEETING_STATUS_TONE,
  TASK_ICON,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_TONE,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  meetingWhen,
  onDay,
} from "@/components/sales/sales-shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/** How many rows a panel shows before pointing at the full list. */
const PANEL_ROWS = 6

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">{children}</div>
}

function PanelHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="text-[13.5px] font-bold">{title}</div>
      {action}
    </div>
  )
}

const ADD_BUTTON = "h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"

function PanelLoading({ title }: { title: string }) {
  return (
    <Panel>
      <PanelHeading title={title} />
      <div className="space-y-3">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
      </div>
    </Panel>
  )
}

function PanelBroken({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Panel>
      <PanelHeading title={title} />
      <div className="flex flex-col items-center gap-2.5 py-4 text-center">
        <span className="flex size-8 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
          <RiErrorWarningLine className="size-4" aria-hidden />
        </span>
        <div className="text-[12.5px] font-semibold text-[#5F6B7C]">This could not be loaded</div>
        <Button
          onClick={onRetry}
          className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
        >
          <RiRefreshLine className="size-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Meetings                                                                    */
/* -------------------------------------------------------------------------- */

/** What a row can do, decided by the meeting's own state and `canManage`. */
export function meetingActions(
  meeting: SalesMeetingSummary,
  handlers: {
    onEdit: () => void
    onComplete: () => void
    onCancel: () => void
    onPutBack: () => void
  }
): RowAction[] {
  if (!meeting.canManage) return []
  if (meeting.status === "SCHEDULED") {
    return [
      { kind: "custom", label: "Completed", icon: <RiCheckLine className="size-3.5" aria-hidden />, onClick: handlers.onComplete },
      { kind: "custom", label: "Cancel", icon: <RiCloseLine className="size-3.5" aria-hidden />, onClick: handlers.onCancel },
      { kind: "edit", label: "Edit", onClick: handlers.onEdit },
    ]
  }
  if (meeting.status === "CANCELLED") {
    return [
      {
        kind: "custom",
        label: "Put back on",
        icon: <RiArrowGoBackLine className="size-3.5" aria-hidden />,
        onClick: handlers.onPutBack,
      },
      { kind: "edit", label: "Edit", onClick: handlers.onEdit },
    ]
  }
  // Completed is final; a later correction goes in its notes.
  return [{ kind: "edit", label: "Edit notes", onClick: handlers.onEdit }]
}

export function MeetingRow({
  meeting,
  actions,
  showAccount = false,
  delayMs = 0,
}: {
  meeting: SalesMeetingSummary
  actions: RowAction[]
  showAccount?: boolean
  delayMs?: number
}) {
  const ours = meeting.attendees.filter((a) => a.side === "OURS").map((a) => a.name)
  const theirs = meeting.attendees.filter((a) => a.side === "THEIRS").map((a) => a.name)
  return (
    <li
      className="rise-in border-b border-[#EEF1F5] py-3 last:border-b-0 motion-reduce:animate-none"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#F1F4F8] text-[#33373D]">
            <MEETING_ICON className="size-3" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[#1C2733]">{meeting.title}</div>
            <div className="mt-0.5 text-[11.5px] text-[#5F6B7C]">
              {[meetingWhen(meeting.scheduledAt), MEETING_MODE_LABEL[meeting.mode], meeting.location]
                .filter(Boolean)
                .join(" · ")}
            </div>
            {showAccount ? (
              <div className="mt-0.5 text-[12px]">
                <Link
                  href={`/sales/accounts/${meeting.salesAccountId}`}
                  className="font-semibold text-[#3D4756] hover:underline"
                >
                  {meeting.salesAccountName}
                </Link>
                {meeting.opportunitySerial ? (
                  <>
                    {" · "}
                    <Link href={`/sales/opportunities/${meeting.opportunityId}`} className="text-[#5F6B7C] hover:underline">
                      {meeting.opportunitySerial}
                    </Link>
                  </>
                ) : null}
              </div>
            ) : null}
            {ours.length > 0 || theirs.length > 0 ? (
              <div className="mt-1 text-[12px] text-[#3D4756]">
                {[ours.length > 0 ? `Us: ${ours.join(", ")}` : null, theirs.length > 0 ? `Them: ${theirs.join(", ")}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
            {meeting.status === "CANCELLED" && meeting.cancelReason ? (
              <div className="mt-1 text-[12px] text-[#5F6B7C]">Cancelled: {meeting.cancelReason}</div>
            ) : null}
            {meeting.outcome ? (
              <div className="mt-1.5 rounded-md bg-[#F7F9FB] px-2.5 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-[#3D4756]">
                {meeting.outcome}
              </div>
            ) : null}
          </div>
        </div>
        <Tag label={MEETING_STATUS_LABEL[meeting.status]} tone={MEETING_STATUS_TONE[meeting.status]} />
      </div>
      {actions.length > 0 ? (
        <div className="mt-1.5">
          <RowActions actions={actions} />
        </div>
      ) : null}
    </li>
  )
}

/** Scheduled meetings from today on, soonest first; then the rest, newest first. */
function inPanelOrder(items: SalesMeetingSummary[]): SalesMeetingSummary[] {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const ahead = items
    .filter((m) => m.status === "SCHEDULED" && new Date(m.scheduledAt) >= startOfToday)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  const behind = items
    .filter((m) => !ahead.includes(m))
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
  return [...ahead, ...behind]
}

export function MeetingsPanel({
  accountId,
  opportunityId,
  canManage,
}: {
  accountId: string
  /** When set, only the meetings about this deal. */
  opportunityId?: string
  canManage: boolean
}) {
  const { accessToken } = useSession()
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [editing, setEditing] = useState<SalesMeetingSummary | null>(null)
  const [ending, setEnding] = useState<{ meeting: SalesMeetingSummary; action: "COMPLETED" | "CANCELLED" } | null>(null)
  const putBack = useMeetingStatus()

  const filters = opportunityId ? { opportunityId } : { salesAccountId: accountId }
  const query = useQuery({
    queryKey: salesKeys.meetings(filters),
    queryFn: () => listMeetings(accessToken!, filters),
    enabled: !!accessToken,
  })

  if (query.isPending) return <PanelLoading title="Meetings" />
  if (query.isError) return <PanelBroken title="Meetings" onRetry={() => query.refetch()} />

  const meetings = inPanelOrder(query.data.items)
  const shown = meetings.slice(0, PANEL_ROWS)

  return (
    <Panel>
      <PanelHeading
        title="Meetings"
        action={
          canManage ? (
            <Button onClick={() => setScheduleOpen(true)} className={ADD_BUTTON}>
              Schedule
            </Button>
          ) : undefined
        }
      />
      {meetings.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
          {opportunityId
            ? "No meetings about this deal yet."
            : "No meetings on this account yet. A visit, a meeting at our office or an online call goes here, with who comes from both sides."}
        </p>
      ) : (
        <ul>
          {shown.map((meeting, i) => (
            <MeetingRow
              key={meeting.id}
              meeting={meeting}
              delayMs={Math.min(i, 6) * 40}
              actions={meetingActions(meeting, {
                onEdit: () => setEditing(meeting),
                onComplete: () => setEnding({ meeting, action: "COMPLETED" }),
                onCancel: () => setEnding({ meeting, action: "CANCELLED" }),
                onPutBack: () => putBack.mutate({ id: meeting.id, body: { status: "SCHEDULED" } }),
              })}
            />
          ))}
        </ul>
      )}
      {meetings.length > shown.length ? (
        <Link
          href="/sales/meetings"
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-[#5F6B7C] hover:underline"
        >
          {`Showing ${shown.length} of ${meetings.length}. All meetings`}
          <RiArrowRightLine className="size-3.5" aria-hidden />
        </Link>
      ) : null}

      <MeetingFormDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        accountId={accountId}
        opportunityId={opportunityId}
      />
      <MeetingFormDialog
        open={!!editing}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        meeting={editing ?? undefined}
      />
      <MeetingStatusDialog
        meeting={ending?.meeting ?? null}
        action={ending?.action ?? null}
        onClose={() => setEnding(null)}
      />
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                       */
/* -------------------------------------------------------------------------- */

/** Only the owner may change a task, a Sales Admin included; the server says who that is. */
export function taskActions(
  task: SalesTaskSummary,
  handlers: { onDone: () => void; onCancel: () => void; onEdit: () => void; onReopen: () => void }
): RowAction[] {
  if (!task.canManage) return []
  if (task.status === "PENDING") {
    return [
      { kind: "custom", label: "Done", icon: <RiCheckLine className="size-3.5" aria-hidden />, onClick: handlers.onDone },
      { kind: "custom", label: "Cancel", icon: <RiCloseLine className="size-3.5" aria-hidden />, onClick: handlers.onCancel },
      { kind: "edit", label: "Edit", onClick: handlers.onEdit },
    ]
  }
  return [
    {
      kind: "custom",
      label: "Reopen",
      icon: <RiArrowGoBackLine className="size-3.5" aria-hidden />,
      onClick: handlers.onReopen,
    },
  ]
}

function TaskItem({ task, actions, delayMs }: { task: SalesTaskSummary; actions: RowAction[]; delayMs: number }) {
  return (
    <li
      className="rise-in border-b border-[#EEF1F5] py-3 last:border-b-0 motion-reduce:animate-none"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#F1F4F8] text-[#33373D]">
            <TASK_ICON className="size-3" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[#1C2733]">{task.title}</div>
            <div className="mt-0.5 text-[11.5px] text-[#5F6B7C]">
              {[`Due ${onDay(task.dueOn)}`, task.canManage ? null : task.assignedToName, task.opportunitySerial]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {task.overdue ? <Tag label="Overdue" tone="red" /> : null}
          {task.priority === "HIGH" ? <Tag label={TASK_PRIORITY_LABEL.HIGH} tone={TASK_PRIORITY_TONE.HIGH} /> : null}
          {task.status !== "PENDING" ? (
            <Tag label={TASK_STATUS_LABEL[task.status]} tone={TASK_STATUS_TONE[task.status]} />
          ) : null}
        </div>
      </div>
      {actions.length > 0 ? (
        <div className="mt-1.5">
          <RowActions actions={actions} />
        </div>
      ) : null}
    </li>
  )
}

export function TasksPanel({
  accountId,
  opportunityId,
  canManage,
}: {
  accountId: string
  /** When set, only the tasks about this deal. */
  opportunityId?: string
  canManage: boolean
}) {
  const { accessToken } = useSession()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<SalesTaskSummary | null>(null)
  const [ending, setEnding] = useState<{ task: SalesTaskSummary; action: "DONE" | "CANCELLED" } | null>(null)
  const reopen = useTaskStatus()

  const filters = {
    ...(opportunityId ? { opportunityId } : { salesAccountId: accountId }),
    status: "PENDING" as const,
  }
  const query = useQuery({
    queryKey: salesKeys.tasks(filters),
    queryFn: () => listTasks(accessToken!, filters),
    enabled: !!accessToken && canManage,
  })

  // Tasks are for the people who work the account (§24.20). Said rather than
  // shown as an empty list, which would read as "nothing to do here".
  if (!canManage) {
    return (
      <Panel>
        <PanelHeading title="Tasks" />
        <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
          Tasks here are open only to the people who work this account, and to Sales Admins.
        </p>
      </Panel>
    )
  }
  if (query.isPending) return <PanelLoading title="Tasks" />
  if (query.isError) return <PanelBroken title="Tasks" onRetry={() => query.refetch()} />

  const tasks = query.data.items
  const shown = tasks.slice(0, PANEL_ROWS)

  return (
    <Panel>
      <PanelHeading
        title="Tasks"
        action={
          <Button onClick={() => setCreateOpen(true)} className={ADD_BUTTON}>
            New task
          </Button>
        }
      />
      {tasks.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
          Nothing open. A task is one thing somebody must do by a date, like calling back or sending a quote, and it
          arrives in their morning email.
        </p>
      ) : (
        <ul>
          {shown.map((task, i) => (
            <TaskItem
              key={task.id}
              task={task}
              delayMs={Math.min(i, 6) * 40}
              actions={taskActions(task, {
                onDone: () => setEnding({ task, action: "DONE" }),
                onCancel: () => setEnding({ task, action: "CANCELLED" }),
                onEdit: () => setEditing(task),
                onReopen: () => reopen.mutate({ id: task.id, body: { status: "PENDING" } }),
              })}
            />
          ))}
        </ul>
      )}
      <Link
        href="/sales/tasks"
        className="mt-2 inline-flex items-center gap-1 text-[12px] font-bold text-[#5F6B7C] hover:underline"
      >
        {tasks.length > shown.length ? `Showing ${shown.length} of ${tasks.length}. All my tasks` : "All my tasks"}
        <RiArrowRightLine className="size-3.5" aria-hidden />
      </Link>

      <TaskFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accountId={accountId}
        opportunityId={opportunityId}
      />
      <TaskFormDialog
        open={!!editing}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        task={editing ?? undefined}
      />
      <TaskStatusDialog task={ending?.task ?? null} action={ending?.action ?? null} onClose={() => setEnding(null)} />
    </Panel>
  )
}
