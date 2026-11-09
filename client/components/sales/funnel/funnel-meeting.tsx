"use client"

/**
 * The Saturday review, as a panel above the team list (revision §27.11).
 *
 * Admin only. It carries who was in the room, whose funnel has been walked,
 * and the week's note. Work is given from a person's page, as a take-out.
 */

import { useState } from "react"

import { RiCheckLine } from "@remixicon/react"

import { PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import type { FunnelMeetingDetail, FunnelTeam } from "@/lib/api/types"
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
}: FunnelMeetingPanelProps) {
  if (!meeting) {
    return (
      <div className="rounded-lg border border-line bg-white px-4 py-4">
        {error ? <PanelAlert>{toMessage(error)}</PanelAlert> : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-body">
              No meeting open for the week of {team.weekStart}
            </p>
            <p className={cn("mt-0.5 text-sm", TONE.muted)}>
              You can walk anybody&apos;s funnel without one. Open a meeting to tick who was in the
              room, mark people reviewed, and write the week&apos;s note.
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
    <div className="rounded-lg border border-line bg-white px-4 py-4">
      {error ? <PanelAlert>{toMessage(error)}</PanelAlert> : null}

      {/* A completed meeting is not an error state, so this is a notice and
          not an alert. It also says plainly what still works (§27.11). */}
      {completed ? (
        <PanelNotice>
          This meeting is completed. Nothing written in it has been locked — reopen it to change a note.
        </PanelNotice>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-body">
            Funnel meeting · week of {meeting.weekStart}
          </p>
          <p className={cn("mt-0.5 text-sm", TONE.muted)}>
            Held {meeting.heldOn}, run by {meeting.ranByName} · {meeting.reviewed.length} of{" "}
            {team.rows.length} walked
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
          <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
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
                        ? "bg-info-tint text-info-ink ring-1 ring-info"
                        : "bg-slate-100 text-ink-muted",
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

          {/* One way to give work: the take-out on a person's page. The old form
              here did the same thing under another name (owner, 2026-11-02). */}
          <p className={cn("mt-4 border-t border-line pt-4 text-xs", TONE.muted)}>
            To give someone work, open their name in the list below and press Take-out.
          </p>
        </div>

        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
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
      className="mt-2 w-full rounded-md border border-line px-3 py-2 text-sm outline-none focus:border-info disabled:opacity-60"
    />
  )
}
