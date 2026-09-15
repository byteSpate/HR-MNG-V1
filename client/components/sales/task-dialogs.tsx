"use client"

/**
 * Making, editing and ending a follow-up task (revision §24, tasks 7-11).
 *
 * A task is always the maker's own in this phase, so there is no "for whom"
 * field: the server sets the owner to whoever sends the form.
 */

import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { changeTaskStatus, createTask, listMeetings, listOpportunities, updateTask } from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type { ChangeTaskStatusBody, SalesTaskPriority, SalesTaskSummary } from "@/lib/api/types"
import { DialogActions, Field, FormError, toMessage } from "@/components/dashboard/record-kit"
import { AccountPicker, usePlanRefresh } from "@/components/sales/meeting-dialogs"
import { TASK_PRIORITY_LABEL, meetingWhen } from "@/components/sales/sales-shared"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

const PRIORITIES = Object.keys(TASK_PRIORITY_LABEL) as SalesTaskPriority[]
/** A select's "none", since an empty value reads as nothing chosen at all. */
const NONE = "none"

/** A status change that needs no form: reopening a done or cancelled task. */
export function useTaskStatus() {
  const { accessToken } = useSession()
  const refresh = usePlanRefresh()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ChangeTaskStatusBody }) => changeTaskStatus(accessToken!, id, body),
    onSuccess: refresh,
  })
}

interface TaskStart {
  title?: string
  dueOn?: string
  opportunityId?: string | null
  meetingId?: string | null
}

export function TaskFormDialog({
  open,
  onOpenChange,
  accountId,
  opportunityId,
  meetingId,
  task,
  start,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fixed when opened from an account or a deal; chosen in the form otherwise. */
  accountId?: string
  opportunityId?: string
  meetingId?: string
  /** Present when editing. */
  task?: SalesTaskSummary
  /** What a new task starts with, like the follow-up the minutes offer. */
  start?: { title?: string; dueOn?: string }
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        {open ? (
          <TaskForm
            fixedAccountId={task?.salesAccountId ?? accountId}
            task={task}
            start={{ opportunityId, meetingId, ...start }}
            submitLabel={task ? "Save" : "Make the task"}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function TaskForm({
  fixedAccountId,
  task,
  start,
  submitLabel,
  onDone,
}: {
  fixedAccountId?: string
  task?: SalesTaskSummary
  start?: TaskStart
  submitLabel: string
  onDone: () => void
}) {
  const { accessToken } = useSession()
  const refresh = usePlanRefresh()

  const [accountId, setAccountId] = useState(fixedAccountId ?? "")
  const [title, setTitle] = useState(task?.title ?? start?.title ?? "")
  const [detail, setDetail] = useState(task?.detail ?? "")
  const [dueOn, setDueOn] = useState(task?.dueOn ?? start?.dueOn ?? "")
  const [priority, setPriority] = useState<SalesTaskPriority>(task?.priority ?? "NORMAL")
  const [dealId, setDealId] = useState(task?.opportunityId ?? start?.opportunityId ?? "")
  const [meetingId, setMeetingId] = useState(task?.meetingId ?? start?.meetingId ?? "")
  const [error, setError] = useState<string | null>(null)

  const enabled = !!accessToken && !!accountId
  const dealsQuery = useQuery({
    queryKey: salesKeys.opportunities({ salesAccountId: accountId }),
    queryFn: () => listOpportunities(accessToken!, { salesAccountId: accountId }),
    enabled,
  })
  const meetingsQuery = useQuery({
    queryKey: salesKeys.meetings({ salesAccountId: accountId }),
    queryFn: () => listMeetings(accessToken!, { salesAccountId: accountId }),
    enabled,
  })
  const deals = dealsQuery.data?.items ?? []
  const meetings = meetingsQuery.data?.items ?? []

  const mutation = useMutation({
    mutationFn: () =>
      task
        ? updateTask(accessToken!, task.id, {
            title: title.trim(),
            detail: detail.trim() || null,
            dueOn,
            priority,
            opportunityId: dealId || null,
            meetingId: meetingId || null,
          })
        : createTask(accessToken!, {
            salesAccountId: accountId,
            title: title.trim(),
            dueOn,
            priority,
            ...(detail.trim() ? { detail: detail.trim() } : {}),
            ...(dealId ? { opportunityId: dealId } : {}),
            ...(meetingId ? { meetingId } : {}),
          }),
    onSuccess: () => {
      refresh()
      onDone()
    },
    onError: (err) => setError(toMessage(err)),
  })

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!accountId) return setError("Choose the account the task is about.")
    if (title.trim().length < 2) return setError("Give the task a title.")
    if (!dueOn) return setError("Pick the day it is due.")
    mutation.mutate()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!fixedAccountId ? (
        <Field label="Account" htmlFor="task-account">
          <AccountPicker
            id="task-account"
            value={accountId}
            onChange={(id) => {
              setAccountId(id)
              setDealId("")
              setMeetingId("")
            }}
          />
        </Field>
      ) : null}

      <Field label="Title" htmlFor="task-title">
        <Input
          id="task-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Call back about the quote"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Due"
          htmlFor="task-due"
          help="It is in your 00:01 email that day, and every day after until it is done."
        >
          <Input id="task-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor="task-priority">
          <Select value={priority} onValueChange={(v) => v && setPriority(v as SalesTaskPriority)}>
            <SelectTrigger id="task-priority" className="w-full">
              <SelectValue>{(v: string | null) => TASK_PRIORITY_LABEL[(v ?? priority) as SalesTaskPriority]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {TASK_PRIORITY_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {accountId ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Deal" htmlFor="task-deal" hint="Optional.">
            <Select value={dealId || NONE} onValueChange={(v) => setDealId(!v || v === NONE ? "" : v)}>
              <SelectTrigger id="task-deal" className="w-full">
                <SelectValue>{(v: string | null) => deals.find((d) => d.id === v)?.serial ?? "Not about one deal"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not about one deal</SelectItem>
                {deals.map((deal) => (
                  <SelectItem key={deal.id} value={deal.id}>{`${deal.serial} · ${deal.name}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Meeting" htmlFor="task-meeting" hint="Optional.">
            <Select value={meetingId || NONE} onValueChange={(v) => setMeetingId(!v || v === NONE ? "" : v)}>
              <SelectTrigger id="task-meeting" className="w-full">
                <SelectValue>
                  {(v: string | null) => meetings.find((m) => m.id === v)?.title ?? "Not from a meeting"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not from a meeting</SelectItem>
                {meetings.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{`${m.title} · ${meetingWhen(m.scheduledAt)}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      ) : null}

      <Field label="Detail" htmlFor="task-detail" hint="Optional.">
        <Textarea id="task-detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
      </Field>

      {error ? <FormError>{error}</FormError> : null}
      <DialogFooter>
        <DialogActions
          pending={mutation.isPending}
          submitLabel={submitLabel}
          disabled={false}
          onCancel={onDone}
          onSubmit={() => submit()}
        />
      </DialogFooter>
    </form>
  )
}

/**
 * Done, with an optional outcome, then the offer of the next follow-up at
 * today plus 15 days (§24.10). Or Cancelled, with a reason.
 */
export function TaskStatusDialog({
  task,
  action,
  onClose,
}: {
  task: SalesTaskSummary | null
  action: "DONE" | "CANCELLED" | null
  onClose: () => void
}) {
  // The follow-up offer replaces the first step in the same dialog, so the
  // question is asked while the person still has the task in mind.
  const [followUpOn, setFollowUpOn] = useState<string | null>(null)
  const close = () => {
    setFollowUpOn(null)
    onClose()
  }

  return (
    <Dialog open={!!task && !!action} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {followUpOn ? "Make the next follow-up?" : action === "CANCELLED" ? "Cancel this task" : "Mark this task done"}
          </DialogTitle>
        </DialogHeader>
        {task && action && followUpOn ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-[#5F6B7C]">
              Done. Here is the next follow-up, due in 15 days. Change anything, or cancel to skip it.
            </p>
            <TaskForm
              fixedAccountId={task.salesAccountId ?? undefined}
              start={{ title: task.title, dueOn: followUpOn, opportunityId: task.opportunityId }}
              submitLabel="Make it"
              onDone={close}
            />
          </>
        ) : task && action ? (
          <TaskStatusForm task={task} action={action} onDone={(next) => (next ? setFollowUpOn(next) : close())} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function TaskStatusForm({
  task,
  action,
  onDone,
}: {
  task: SalesTaskSummary
  action: "DONE" | "CANCELLED"
  /** Called with the follow-up date to offer, or null when there is none. */
  onDone: (followUpOn: string | null) => void
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const status = useTaskStatus()

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    if (action === "CANCELLED" && text.trim().length < 2) {
      setError("Say why the task is cancelled.")
      return
    }
    const body: ChangeTaskStatusBody =
      action === "CANCELLED"
        ? { status: "CANCELLED", reason: text.trim() }
        : { status: "DONE", ...(text.trim() ? { outcome: text.trim() } : {}) }
    status.mutate(
      { id: task.id, body },
      {
        onSuccess: (result) => onDone(result.nextFollowUpOn ?? null),
        onError: (err) => setError(toMessage(err)),
      }
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[12.5px] font-semibold text-[#1C2733]">{task.title}</p>
      {action === "CANCELLED" ? (
        <Field label="Why is it cancelled?" htmlFor="task-reason">
          <Input id="task-reason" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      ) : (
        <Field label="What came of it?" htmlFor="task-outcome" hint="Optional.">
          <Textarea id="task-outcome" value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      )}
      {error ? <FormError>{error}</FormError> : null}
      <DialogFooter>
        <DialogActions
          pending={status.isPending}
          submitLabel={action === "CANCELLED" ? "Cancel the task" : "Mark done"}
          disabled={false}
          onCancel={() => onDone(null)}
          onSubmit={() => submit()}
        />
      </DialogFooter>
    </form>
  )
}
