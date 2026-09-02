"use client"

import { useEffect } from "react"
import { RiLoader4Line, RiLoginBoxLine, RiLogoutBoxLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tag } from "@/components/dashboard/tag"
import type { TodayAttendance } from "@/lib/api/types"
import {
  APPROVAL_LABEL,
  APPROVAL_TONE,
  formatClock,
  formatElapsed,
  formatHours,
  formatShiftSpan,
  minutesLate,
} from "@/components/attendance/attendance-shared"
import { useOfficeDate, useServerClock } from "@/components/attendance/use-server-clock"

/**
 * What today is, for anyone not expected in — and, on a half day, the half
 * they *are* expected for.
 *
 * The check-in button stays exactly as it is on every other day, deliberately.
 * The server accepts a punch on a holiday because somebody who genuinely came
 * in must be able to record it, and a half-day leave is *expected* to carry a
 * punch for the other half. Demoting the button would make the honest case
 * harder in order to prevent the careless one. Saying what the day is, above
 * the button rather than under it, does the same job without that cost.
 *
 * Ordered so the most specific case wins: a half day is a leave day and an
 * ON_LEAVE day may also be a holiday, and the narrower sentence is the useful
 * one in both cases.
 */
function dayNotice(
  today: TodayAttendance
): { heading: string; body: string } | null {
  const span = formatShiftSpan(
    today.shift.startTime,
    today.shift.endTime,
    today.shift.breakMinutes
  )

  if (today.leaveFraction === 0.5) {
    return {
      heading: `Half day — ${today.detail ?? "approved leave"}`,
      body: `You are expected for ${span}. Your leave covers the other half either way.`,
    }
  }

  if (today.status === "ON_LEAVE") {
    return {
      heading: today.detail ?? "Approved leave",
      body: "You are not expected in. Your leave stays approved whether or not you check in.",
    }
  }

  if (today.status === "HOLIDAY") {
    return {
      heading: today.detail ?? "Public holiday",
      body: "You are not expected in. Check in only if you are actually working today.",
    }
  }

  if (today.status === "WEEKLY_OFF") {
    // The grid sets no detail on a weekly off, so this is the only place the
    // day gets named at all — it previously showed a bare "Check in".
    return {
      heading: "Weekly off",
      body: "You are not expected in. Check in only if you are actually working today.",
    }
  }

  // Already punched on a day off: the status flips to PRESENT and the detail
  // carries the holiday name. Worth confirming rather than going quiet.
  if (today.status === "PRESENT" && today.detail) {
    return {
      heading: `Working on ${today.detail}`,
      body: "Recorded as a day worked outside your normal schedule.",
    }
  }

  return null
}

export function PunchCard({
  today,
  isLoading,
  isPunching,
  error,
  onCheckIn,
  onCheckOut,
  onDayRollover,
}: {
  today: TodayAttendance | undefined
  isLoading: boolean
  isPunching: boolean
  error: string | null
  onCheckIn: () => void
  onCheckOut: () => void
  onDayRollover: () => void
}) {
  const now = useServerClock(today?.serverTime)
  const clientDate = useOfficeDate(now)

  // A dashboard left open overnight would otherwise still be offering a
  // check-out for yesterday at 00:01.
  useEffect(() => {
    if (today && clientDate !== today.date) onDayRollover()
  }, [clientDate, today, onDayRollover])

  if (isLoading || !today) {
    return (
      <div className="rounded-md border border-[#E4E9EF] bg-white p-5.5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-3 h-10 w-full" />
      </div>
    )
  }

  const late = today.isLate ? minutesLate(today.checkIn, today.shift.startTime) : null
  const elapsed =
    today.checkIn && !today.checkOut ? now.getTime() - new Date(today.checkIn).getTime() : null

  const notice = dayNotice(today)

  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white p-5.5">
      {/* Above the button, not below it: the point is to be read before the
          tap, not to explain one that already happened. */}
      {notice ? (
        <div className="mb-4 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#8A5E0C]">
          <div className="font-bold">{notice.heading}</div>
          <div className="mt-0.5">{notice.body}</div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11.5px] font-bold tracking-wide text-[#5F6B7C] uppercase">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <div className="font-heading mt-1 text-[28px] font-bold tracking-tight tabular-nums">
            {now.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            })}
          </div>
          <div className="mt-0.5 text-xs text-[#5F6B7C]">
            {today.shift.name} · {formatShiftSpan(
              today.shift.startTime,
              today.shift.endTime,
              today.shift.breakMinutes
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {today.canCheckIn ? (
            <Button
              onClick={onCheckIn}
              disabled={isPunching}
              className="h-auto rounded-md bg-[#17191C] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#0E1012]"
            >
              {isPunching ? (
                <RiLoader4Line className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RiLoginBoxLine className="mr-1.5 size-4" aria-hidden="true" />
              )}
              Check in
            </Button>
          ) : today.canCheckOut ? (
            <Button
              onClick={onCheckOut}
              disabled={isPunching}
              className="h-auto rounded-md bg-[#17191C] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#0E1012]"
            >
              {isPunching ? (
                <RiLoader4Line className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RiLogoutBoxLine className="mr-1.5 size-4" aria-hidden="true" />
              )}
              Check out
            </Button>
          ) : (
            <div className="rounded-md bg-[#F2F5F8] px-4 py-2.5 text-[13px] font-semibold text-[#3D4756]">
              Done for today
            </div>
          )}

          {/* The approval step is invisible to the person it affects unless
              it is said out loud. Checking out never clears it — a named
              manager or HR does, so the tag stays "awaiting review" until
              somebody actually decides. */}
          {today.approval && today.checkOut ? (
            <Tag tone={APPROVAL_TONE[today.approval]} label={APPROVAL_LABEL[today.approval]} />
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#EEF1F5] pt-4 sm:grid-cols-4">
        <Detail label="Checked in" value={formatClock(today.checkIn)} />
        <Detail label="Checked out" value={formatClock(today.checkOut)} />
        <Detail
          label={elapsed !== null ? "Elapsed" : "Hours"}
          value={elapsed !== null ? formatElapsed(elapsed) : formatHours(today.workedHours)}
        />
        <Detail
          label="Status"
          value={
            late !== null
              ? `Late by ${late} min`
              : today.isEarlyOut
                ? "Left early"
                : today.checkIn
                  ? "On time"
                  : "—"
          }
        />
      </div>

      {/* The bare detail box that used to sit here is gone: it repeated the
          leave or holiday name under the button, after the tap it was meant
          to inform. `dayNotice` says the same thing above, and says what it
          means for the person reading it. */}

      {/* Never optimistic: on a flaky connection an optimistic UI tells
          somebody they are checked in when they are not, and they find out
          on payday. */}
      {error ? (
        <div className="mt-3 rounded-md border border-[#F0D2D2] bg-[#FDF6F6] px-3.5 py-2.5 text-[12.5px] font-semibold text-[#B03A3A]">
          {error}
        </div>
      ) : null}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold tracking-wide text-[#5F6B7C] uppercase">{label}</div>
      <div className="mt-0.5 text-[13.5px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
