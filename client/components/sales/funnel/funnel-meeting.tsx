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
import { Button } from "@/components/ui/button"
import type { FunnelActionBody, FunnelMeetingDetail, FunnelTeam } from "@/lib/api/types"
import { cn } from "@/lib/utils"

interface FunnelMeetingPanelProps {
  meeting: FunnelMeetingDetail | null
  team: FunnelTeam
  busy: boolean
  error: unknown
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
  onOpen,
  onToggleAttendee,
  onSaveNote,
  onComplete,
  onReopen,
  onCreateAction,
}: FunnelMeetingPanelProps) {
  const [note, setNote] = useState(meeting?.note ?? "")
  const [actionTitle, setActionTitle] = useState("")
  const [actionDetail, setActionDetail] = useState("")
  const [assigneeId, setAssigneeId] = useState("")

  async function submitAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!assigneeId || !actionTitle.trim()) return
    await onCreateAction({
      assignedToEmployeeId: assigneeId,
      title: actionTitle.trim(),
      detail: actionDetail.trim() || null,
    })
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
              <Button type="submit" size="sm" className="mt-2" disabled={busy}>
                {busy ? "Giving…" : "Give action item"}
              </Button>
            </form>
          ) : null}
        </div>

        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-[#5F6B7C]">
            Note for the week
          </h4>
          <textarea
            value={note}
            disabled={completed || busy}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => onSaveNote(note.trim() === "" ? null : note.trim())}
            rows={4}
            placeholder="What was decided across the team this week"
            className="mt-2 w-full rounded-md border border-[#E4E9EF] px-3 py-2 text-sm outline-none focus:border-[#2D6CB5] disabled:opacity-60"
          />
        </div>
      </div>
    </div>
  )
}
