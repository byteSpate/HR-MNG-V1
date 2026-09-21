"use client"

/**
 * The Saturday review, as a panel above the team list (revision §27.11).
 *
 * Admin only. It carries who was in the room, whose funnel has been walked,
 * the week's note, and how many action items were handed out.
 */

import { useState, type FormEvent } from "react"

import { RiCheckLine } from "@remixicon/react"

import { PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { onDay } from "@/components/sales/shared/sales-shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  FunnelActionBody,
  FunnelMeetingDetail,
  FunnelTeam,
  SalesTaskSummary,
} from "@/lib/api/types"
import { cn } from "@/lib/utils"

const TASK_STATUS_LABEL: Record<SalesTaskSummary["status"], string> = {
  PENDING: "Open",
  DONE: "Done",
  CANCELLED: "Cancelled",
}

interface FunnelMeetingPanelProps {
  meeting: FunnelMeetingDetail | null
  team: FunnelTeam
  busy: boolean
  error: unknown
  /**
   * What has been handed out at this meeting. Loading, broken and empty are
   * three different things here, so they arrive as three different fields.
   */
  actions: { items: SalesTaskSummary[] | undefined; loading: boolean; error: unknown }
  onOpen: () => void
  onToggleAttendee: (employeeId: string, present: boolean) => void
  onSaveNote: (note: string | null) => void
  onComplete: () => void
  onReopen: () => void
  onCreateAction: (body: FunnelActionBody) => Promise<unknown>
}

export function FunnelMeetingPanel({
  meeting,
  team,
  busy,
  error,
  actions,
  onOpen,
  onToggleAttendee,
  onSaveNote,
  onComplete,
  onReopen,
  onCreateAction,
}: FunnelMeetingPanelProps) {
  const [actionTitle, setActionTitle] = useState("")
  const [actionDetail, setActionDetail] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [actionError, setActionError] = useState<unknown>(null)

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assigneeId || !actionTitle.trim()) return
    setActionError(null)
    try {
      await onCreateAction({
        assignedToEmployeeId: assigneeId,
        title: actionTitle.trim(),
        detail: actionDetail.trim() || null,
      })
    } catch (err) {
      // The form keeps what was typed: a refusal (the meeting was completed a
      // moment ago, say) is worth reading, and retyping it is not.
      setActionError(err)
      return
    }
    setActionTitle("")
    setActionDetail("")
    setAssigneeId("")
  }

  if (!meeting) {
    return (
      <div className="rounded-lg border border-[#E4E9EF] bg-white px-4 py-4">
        {error ? <PanelAlert>{toMessage(error)}</PanelAlert> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[#1B2733]">
              No meeting open for the week of {team.weekStart}
            </p>
            <p className={cn("mt-0.5 text-sm", TONE.muted)}>
              You can walk anybody&apos;s funnel without one. Open a meeting to tick who was in the
              room, mark people reviewed, and hand out action items.
            </p>
          </div>
          <Button onClick={onOpen} disabled={busy}>
            Open the meeting
          </Button>
        </div>
      </div>
    )
  }

  const completed = meeting.status === "COMPLETED"
  const attending = new Set(meeting.attendees.map((a) => a.employeeId))

  return (
    <div className="rounded-lg border border-[#E4E9EF] bg-white px-4 py-4">
      {error ? <PanelAlert>{toMessage(error)}</PanelAlert> : null}

      {/* A completed meeting is not an error state, so this is a notice and
          not an alert. It also says plainly what still works (§27.11). */}
      {completed ? (
        <PanelNotice>
          This meeting is completed. Nothing written in it has been locked — reopen it to add a note
          or another action item.
        </PanelNotice>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[#1B2733]">
            Funnel meeting · week of {meeting.weekStart}
          </p>
          <p className={cn("mt-0.5 text-sm", TONE.muted)}>
            Held {meeting.heldOn}, run by {meeting.ranByName} · {meeting.reviewed.length} of{" "}
            {team.rows.length} walked · {meeting.actionItemCount}{" "}
            {meeting.actionItemCount === 1 ? "action item" : "action items"}
          </p>
        </div>
        {completed ? (
          <Button variant="outline" onClick={onReopen} disabled={busy}>
            Reopen
          </Button>
        ) : (
          <Button onClick={onComplete} disabled={busy}>
            Complete
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
            Who is in the room
          </h4>
          <ul className="mt-2 flex flex-wrap gap-2">
            {team.rows.map((person) => {
              const here = attending.has(person.employeeId)
              return (
                <li key={person.employeeId}>
                  <button
                    type="button"
                    disabled={completed || busy}
                    onClick={() => onToggleAttendee(person.employeeId, !here)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm",
                      here
                        ? "bg-[#EAF2FB] text-[#1F4E79] ring-1 ring-[#2D6CB5]"
                        : "bg-slate-100 text-[#5F6B7C]",
                      (completed || busy) && "opacity-60"
                    )}
                  >
                    {here ? <RiCheckLine className="size-3.5" aria-hidden /> : null}
                    {person.employeeName}
                  </button>
                </li>
              )
            })}
          </ul>
          {/* The distinction that matters, said where it is used (§27.3). */}
          <p className={cn("mt-2 text-xs", TONE.muted)}>
            Being in the room and having your funnel walked are separate. Mark people reviewed on
            their own grid.
          </p>

          {!completed ? (
            <form onSubmit={(event) => void submitAction(event)} className="mt-4 border-t border-[#E4E9EF] pt-4">
              <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
                Give an action item
              </h4>
              <p className={cn("mt-1 text-xs", TONE.muted)}>
                It is due next Saturday and appears in the recipient&apos;s task list.
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <select
                  value={assigneeId}
                  onChange={(event) => setAssigneeId(event.target.value)}
                  required
                  className="rounded-md border border-[#E4E9EF] bg-white px-3 py-2 text-sm outline-none focus:border-[#2D6CB5]"
                >
                  <option value="">Assign to…</option>
                  {team.rows.map((person) => (
                    <option key={person.employeeId} value={person.employeeId}>
                      {person.employeeName}
                    </option>
                  ))}
                </select>
                <input
                  value={actionTitle}
                  onChange={(event) => setActionTitle(event.target.value)}
                  required
                  maxLength={200}
                  placeholder="What needs doing?"
                  className="rounded-md border border-[#E4E9EF] px-3 py-2 text-sm outline-none focus:border-[#2D6CB5]"
                />
              </div>
              <textarea
                value={actionDetail}
                onChange={(event) => setActionDetail(event.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Optional context"
                className="mt-2 w-full rounded-md border border-[#E4E9EF] px-3 py-2 text-sm outline-none focus:border-[#2D6CB5]"
              />
              {actionError ? (
                <div className="mt-2">
                  <PanelAlert>{toMessage(actionError)}</PanelAlert>
                </div>
              ) : null}
              <Button type="submit" size="sm" className="mt-2" disabled={busy}>
                {busy ? "Giving…" : "Give action item"}
              </Button>
            </form>
          ) : null}

          {/* Shown on a completed meeting too: what was handed out is the
              record of the meeting, not a control. */}
          <div className="mt-4 border-t border-[#E4E9EF] pt-4">
            <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
              Given at this meeting
            </h4>
            {actions.loading ? (
              <Skeleton className="mt-2 h-12 w-full" />
            ) : actions.error ? (
              <div className="mt-2">
                <PanelAlert>{toMessage(actions.error)}</PanelAlert>
              </div>
            ) : !actions.items || actions.items.length === 0 ? (
              <p className={cn("mt-2 text-sm", TONE.muted)}>
                No action items have been given at this meeting yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {actions.items.map((item) => (
                  <li key={item.id} className="rounded-md bg-white px-3 py-2 ring-1 ring-[#E4E9EF]">
                    <p className="text-sm font-medium text-[#1B2733]">{item.title}</p>
                    <p className={cn("text-xs", TONE.muted)}>
                      To {item.assignedToName} · due {onDay(item.dueOn)} ·{" "}
                      {TASK_STATUS_LABEL[item.status]}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
            Note for the week
          </h4>
          {/* Keyed to the meeting, so opening a different one starts a fresh
              editor rather than carrying the last one's text across. */}
          <WeekNote
            key={meeting.id}
            saved={meeting.note}
            disabled={completed || busy}
            onSave={onSaveNote}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * The week's note, edited in place and saved when you click away.
 *
 * Two things this must not do. It must not seed its text once and then ignore
 * the server (a panel that first mounts with no meeting, then gains one, would
 * show an empty box over a saved note). And it must not save on every blur: a
 * click in and out of an empty box would send `null` and erase the note, so a
 * blur writes only when the text is different from what is saved.
 */
function WeekNote({
  saved,
  disabled,
  onSave,
}: {
  saved: string | null
  disabled: boolean
  onSave: (note: string | null) => void
}) {
  const [draft, setDraft] = useState(saved ?? "")
  const [focused, setFocused] = useState(false)

  // Follows the saved note during render, as `FunnelCell` does with its value,
  // and for the same reason: an effect would paint the stale text first.
  // Guarded on focus so a refetch cannot overwrite what is half-typed.
  const [syncedTo, setSyncedTo] = useState(saved)
  if (!focused && saved !== syncedTo) {
    setSyncedTo(saved)
    setDraft(saved ?? "")
  }

  return (
    <textarea
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        const next = draft.trim()
        if (next !== (saved ?? "").trim()) onSave(next === "" ? null : next)
      }}
      rows={4}
      placeholder="What was decided across the team this week"
      className="mt-2 w-full rounded-md border border-[#E4E9EF] px-3 py-2 text-sm outline-none focus:border-[#2D6CB5] disabled:opacity-60"
    />
  )
}
