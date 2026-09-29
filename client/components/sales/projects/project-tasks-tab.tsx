"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAddLine } from "@remixicon/react"

import { addProjectTask, cancelProjectTask, listProjectTasks } from "@/lib/api/sales/projects"
import { changeTaskStatus } from "@/lib/api/sales/tasks"
import { planWriteKeys, salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { ProjectSummary, SalesTaskSummary } from "@/lib/api/types"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { Button } from "@/components/ui/button"
import { Field, PanelAlert, PanelTable, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Input } from "@/components/ui/input"
import { TASK_STATUS_LABEL } from "@/components/sales/shared/sales-shared"
import { projectTaskChoices, taskPeople } from "@/components/sales/shared/task-choices"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

const STATUS_TONE = {
  PENDING: "neutral",
  DONE: "green",
  CANCELLED: "neutral",
} as const

/**
 * The work on a Project (spec §2.1). A Project Task is a `SalesTask`, so it
 * also shows on the person's own Tasks page and carries the same reminder.
 *
 * Only three things are asked for: what to do, by when, and who does it. There
 * is no priority and no progress field, because a Project's own milestones and
 * the Project's progress number say where the work has got to.
 */
export function ProjectTasksTab({ project }: { project: ProjectSummary }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState("")
  const [dueOn, setDueOn] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [cancelling, setCancelling] = useState<SalesTaskSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const tasks = useQuery({
    queryKey: salesKeys.projectTasks(project.id),
    queryFn: () => listProjectTasks(accessToken!, project.id),
    enabled: !!accessToken,
  })

  // The Project Manager gives tasks to others, and the "who" box starts on the
  // manager. A team member takes work for themselves: the page sends no name and
  // the server reads who is asking, so the page never has to guess.
  const people = taskPeople(
    { employeeId: project.manager.employeeId, fullName: project.manager.fullName },
    project.team.map((m) => ({ employeeId: m.employeeId, fullName: m.fullName })),
  )
  const mayAdd = project.canManage || project.canTick
  const who = assigneeId || project.manager.employeeId

  const invalidate = async () => {
    // The numbers on the Status tab move with the tasks, and the person's own
    // Tasks page and its badges move with them too.
    await queryClient.invalidateQueries({ queryKey: salesKeys.project(project.id) })
    await queryClient.invalidateQueries({ queryKey: planWriteKeys() })
  }

  const add = useMutation({
    mutationFn: () =>
      addProjectTask(accessToken!, project.id, {
        title, dueOn, ...(project.canManage ? { assigneeEmployeeId: who } : {}),
      }),
    onSuccess: async () => {
      setTitle(""); setDueOn(""); setAdding(false); setError(null)
      await invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const done = useMutation({
    mutationFn: (task: SalesTaskSummary) => changeTaskStatus(accessToken!, task.id, { status: "DONE" }),
    onSuccess: async () => { setError(null); await invalidate() },
    onError: (err) => setError(toMessage(err)),
  })

  const cancel = useMutation({
    mutationFn: ({ task, reason }: { task: SalesTaskSummary; reason: string }) =>
      cancelProjectTask(accessToken!, task.id, reason),
    onSuccess: async () => { setCancelling(null); setError(null); await invalidate() },
    onError: (err) => setError(toMessage(err)),
  })

  const rows = (tasks.data ?? []).map((task) => [
    {
      node: (
        <span className="block min-w-0">
          <span className="block truncate">{task.title}</span>
          {task.cancelReason ? (
            <span className="block truncate text-[11.5px] text-[#6B7789]">
              Cancelled: {task.cancelReason}
            </span>
          ) : null}
        </span>
      ),
    },
    { node: <span className="block truncate">{task.assignedToName}</span> },
    {
      node: (
        <span className={task.overdue ? "text-[#B03A3A]" : undefined}>{task.dueOn}</span>
      ),
    },
    { tag: TASK_STATUS_LABEL[task.status], tone: STATUS_TONE[task.status] },
    {
      node: (
        <span className="flex flex-wrap items-center gap-2">
          {/* The assignee closes their own task; the Manager cancels one. */}
          {(() => {
            const choices = projectTaskChoices(task, project.canManage)
            return (
              <>
                {choices.done ? (
                  <Button
                    type="button"
                    variant="link"
                    disabled={done.isPending}
                    onClick={() => done.mutate(task)}
                    className="h-auto p-0 text-[12px] font-bold underline"
                  >
                    Mark done
                  </Button>
                ) : null}
                {choices.cancel ? (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => setCancelling(task)}
                    className="h-auto p-0 text-[12px] font-bold text-[#5F6B7C] underline"
                  >
                    Cancel
                  </Button>
                ) : null}
              </>
            )
          })()}
        </span>
      ),
    },
  ])

  return (
    <Panel>
      <PanelHeading
        title="Tasks"
        action={
          mayAdd && !adding ? (
            <Button
              type="button"
              onClick={() => { setAssigneeId(""); setAdding(true) }}
              className="h-8 gap-1 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
            >
              <RiAddLine className="size-3.5" aria-hidden />
              Add
            </Button>
          ) : undefined
        }
      />

      {error ? <PanelAlert>{error}</PanelAlert> : null}

      <PanelTable
        cols="minmax(0,2fr) minmax(0,1fr) minmax(0,0.8fr) auto minmax(0,1fr)"
        headers={["What", "Who", "Due", "Status", ""]}
        rows={rows}
        isLoading={tasks.isPending}
        isError={tasks.isError}
        onRetry={() => tasks.refetch()}
        emptyTitle="No tasks yet"
        emptyBody="Add what needs to be done, who does it, and by when."
        onEmptyAction={() => tasks.refetch()}
      />

      {adding ? (
        <div className="mt-3 grid gap-3 border-t border-[#E4E9EF] pt-3 sm:grid-cols-3">
          <Field label="What" htmlFor="pt-title">
            <Input id="pt-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Due date" htmlFor="pt-due">
            <Input id="pt-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
          {project.canManage ? (
            <Field label="Who" htmlFor="pt-who" hint="Project Manager or team.">
              <select
                id="pt-who"
                value={who}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={SELECT}
              >
                {people.map((p) => (
                  <option key={p.employeeId} value={p.employeeId}>{p.fullName}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Who" hint="You take your own work.">
              <p className={`text-[13px] ${TONE.muted}`}>You</p>
            </Field>
          )}
          <div className="sm:col-span-3">
            <Button
              type="button"
              disabled={add.isPending || title.trim().length < 2 || !dueOn}
              onClick={() => add.mutate()}
              className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              {add.isPending ? "Saving…" : "Add task"}
            </Button>
          </div>
        </div>
      ) : null}

      {cancelling ? (
        <CancelTaskDialog
          pending={cancel.isPending}
          onCancel={() => setCancelling(null)}
          onConfirm={(reason) => cancel.mutate({ task: cancelling, reason })}
        />
      ) : null}
    </Panel>
  )
}

/** A cancel always says why, so a month later the work is not simply gone. */
function CancelTaskDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState("")
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this task</DialogTitle>
          <DialogDescription>
            The task stays on the list as cancelled, with the reason. It is not deleted.
          </DialogDescription>
        </DialogHeader>
        <Field label="Why" htmlFor="cancel-reason" help="A sentence is enough. It is kept in the Project's history.">
          <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button
            type="button"
            variant="link"
            onClick={onCancel}
            className="h-auto p-0 text-[12.5px] font-bold underline"
          >
            Keep it
          </Button>
          <Button
            type="button"
            disabled={pending || reason.trim().length < 2}
            onClick={() => onConfirm(reason.trim())}
            className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
          >
            {pending ? "Cancelling…" : "Cancel the task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
