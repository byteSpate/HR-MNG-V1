"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"

import { applyForLeave, getHalfDayWindow } from "@/lib/api/leave"
import { listHolidays } from "@/lib/api/attendance"
import { ApiError } from "@/lib/api/client"
import type { HalfDayWindow, LeaveBalanceItem, LeaveType } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  countChargedDays,
  EMPTY_LEAVE_CALENDAR,
  isNonWorkingDay,
  parseDateString,
  toDateString,
  type LeaveCalendar,
} from "@/lib/utils"

/** Mirrors MAX_BACKDATE_DAYS on the server. */
const MAX_BACKDATE_DAYS = 30

/**
 * The three shapes a single day can take. Declared out here so the control is
 * a map rather than three near-identical blocks of JSX.
 *
 * `window` is rendered as a caption *below* the group rather than inside each
 * button: a two-line button would not match the height of every other control
 * in this dialog, and the times are only knowable once a date is picked.
 */
const DURATION_CHOICES: Array<{
  value: "FULL" | "FIRST_HALF" | "SECOND_HALF"
  label: string
  window: (w: HalfDayWindow) => string
}> = [
  { value: "FULL", label: "Full day", window: (w) => `${w.startTime} – ${w.endTime}` },
  { value: "FIRST_HALF", label: "First half", window: (w) => `${w.startTime} – ${w.midpoint}` },
  { value: "SECOND_HALF", label: "Second half", window: (w) => `${w.midpoint} – ${w.endTime}` },
]

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** `25 Aug 2026` — for naming a date back to the person who just picked it. */
function longDay(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function ApplyLeaveDialog({
  open,
  onOpenChange,
  leaveTypes,
  balances,
  accessToken,
  onApplied,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  leaveTypes: LeaveType[]
  balances: LeaveBalanceItem[]
  accessToken: string
  onApplied: () => void
}) {
  const [leaveTypeId, setLeaveTypeId] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [reason, setReason] = useState("")
  /**
   * Decides the shape of the rest of the form. Leading with this rather than
   * inferring "single day" from two dates that happen to match is what makes
   * the half-day option findable: it is on screen from the start instead of
   * appearing once you pick the same date twice.
   */
  const [mode, setMode] = useState<"SINGLE" | "RANGE">("SINGLE")
  const [duration, setDuration] = useState<"FULL" | "FIRST_HALF" | "SECOND_HALF">("FULL")
  const [formError, setFormError] = useState<string | null>(null)

  const selectedType = leaveTypes.find((t) => t.id === leaveTypeId) ?? null
  const selectedBalance = balances.find((b) => b.leaveTypeId === leaveTypeId) ?? null

  // Unpaid, zero-quota types have no balance to run down, so no warning applies.
  const isUnpaidType = !!selectedType && !selectedType.isPaid && selectedType.annualQuota === 0

  // §117: earned and maternity leave are charged in calendar days, so a
  // holiday inside the range is a day of leave rather than a day that
  // vanishes. Casual and sick are the other way round.
  const countsHolidays = !!selectedType?.countsHolidays

  // The gazetted calendar, so the preview charges what the server will. A
  // preview that quietly disagrees is worse than none: the employee reads
  // "2 days", the balance drops by 3, and nothing on screen explains it.
  const thisYear = new Date().getFullYear()
  const holidaysQuery = useQuery({
    queryKey: ["holidays", thisYear],
    queryFn: () => listHolidays(accessToken, thisYear),
    enabled: open,
  })

  const calendar: LeaveCalendar = useMemo(() => {
    if (!holidaysQuery.data) return EMPTY_LEAVE_CALENDAR
    const built: LeaveCalendar = { holidayDates: new Set(), workingOverrides: new Set() }
    for (const holiday of holidaysQuery.data) {
      if (holiday.type === "WORKING_DAY") built.workingOverrides.add(holiday.date)
      else built.holidayDates.add(holiday.date)
    }
    return built
  }, [holidaysQuery.data])

  const earliestSelectable = useMemo(() => {
    const today = startOfToday()
    if (selectedType?.allowsBackdating) return addDays(today, -MAX_BACKDATE_DAYS)
    return today
  }, [selectedType])

  /**
   * Past dates are selectable only for backdating-enabled types. The native
   * date input enforces this bound itself, so it never has to be explained.
   */
  const earliestSelectableDate = toDateString(earliestSelectable)

  /**
   * Why a specific day cannot be taken, or null.
   *
   * Days off are blocked only for types that would not charge them — blocking
   * them for earned or maternity leave would make a 120-day range impossible
   * to pick. Stated as a sentence rather than a greyed-out square: a day the
   * user cannot have is worth a reason, and it is the reason people ask HR
   * about.
   */
  const dayOffReason = (date: Date): string | null => {
    if (countsHolidays || !isNonWorkingDay(date, calendar)) return null
    return `${longDay(date)} is a weekly off or a holiday, and ${selectedType?.name ?? "this leave type"} is not charged on those days. Pick a working day.`
  }

  // Halves are single-day only, and gated per type: a §46 maternity benefit
  // is not taken in halves. The two conditions are kept apart because they
  // read differently on screen — the mode hides the control, the type
  // disables it with a reason.
  const isSingleDay = mode === "SINGLE"
  const typeAllowsHalfDay = !!selectedType?.allowsHalfDay
  const canHalfDay = isSingleDay && typeAllowsHalfDay

  const halfDayWindowQuery = useQuery({
    queryKey: ["half-day-window", startDate],
    queryFn: () => getHalfDayWindow(accessToken, startDate),
    enabled: canHalfDay && !!startDate,
  })
  const halfDayWindow = halfDayWindowQuery.data ?? null

  // Derived rather than reset in an effect, so a stale choice can never be
  // submitted: switching to a range or to a whole-days-only type makes the
  // stored `duration` inapplicable, and this falls straight back to a whole
  // day without a render in between where the two disagree.
  const effectiveDuration = canHalfDay ? duration : "FULL"

  // The employee picks a half, never a time: a typed time would not line up
  // with the shift midpoint and attendance would have nothing to check the
  // punch against.
  const sessions =
    effectiveDuration === "FULL"
      ? { startSession: "FIRST_HALF" as const, endSession: "SECOND_HALF" as const }
      : effectiveDuration === "FIRST_HALF"
        ? { startSession: "FIRST_HALF" as const, endSession: "FIRST_HALF" as const }
        : { startSession: "SECOND_HALF" as const, endSession: "SECOND_HALF" as const }

  const chargedDays = useMemo(() => {
    if (!startDate || !endDate) return null
    const start = parseDateString(startDate)
    const end = parseDateString(endDate)
    if (end.getTime() < start.getTime()) return null
    return countChargedDays(start, end, sessions.startSession, sessions.endSession, {
      countsHolidays,
      calendar,
    })
  }, [startDate, endDate, countsHolidays, calendar, sessions.startSession, sessions.endSession])

  const exceedsBalance =
    chargedDays !== null && !isUnpaidType && !!selectedBalance && chargedDays > selectedBalance.balance

  const applyMutation = useMutation({
    mutationFn: () =>
      applyForLeave(accessToken, {
        leaveTypeId,
        startDate,
        endDate,
        ...sessions,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      resetForm()
      onOpenChange(false)
      onApplied()
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  function resetForm() {
    setLeaveTypeId("")
    setStartDate("")
    setEndDate("")
    setReason("")
    setMode("SINGLE")
    setDuration("FULL")
    setFormError(null)
  }

  /**
   * Switching shape keeps whatever date is already picked rather than
   * clearing it — the employee chose that day, and making them pick it again
   * is the kind of small rudeness that makes a form feel hostile.
   */
  function handleModeChange(next: "SINGLE" | "RANGE") {
    setMode(next)
    // In single-day mode both ends are the same date, so the payload and the
    // day count need no special case anywhere downstream.
    if (next === "SINGLE") setEndDate(startDate)
    setFormError(null)
  }

  /** In single-day mode one picker drives both ends of the request. */
  function handleSingleDateChange(next: string) {
    setStartDate(next)
    setEndDate(next)
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm()
    onOpenChange(next)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    // Only the checks the client can answer on its own. Balance, eligibility,
    // overlap and backdating stay server-authoritative.
    if (!leaveTypeId || !startDate || !endDate) {
      setFormError("Pick a leave type and both dates.")
      return
    }
    if (parseDateString(endDate).getTime() < parseDateString(startDate).getTime()) {
      setFormError("The end date cannot be before the start date")
      return
    }
    applyMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="mb-1.5 text-xs font-bold">Leave type</Label>
            <Select
              value={leaveTypeId}
              onValueChange={(v) => {
                setLeaveTypeId(v ?? "")
                // Backdating rules differ per type, so a date valid for the old
                // type may not be valid for the new one.
                setStartDate("")
                setEndDate("")
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    leaveTypes.find((t) => t.id === v)?.name ?? "Select a leave type"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {leaveTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedBalance && !isUnpaidType ? (
              <p className="mt-1.5 text-xs text-[#5F6B7C]">
                {selectedBalance.balance} of {selectedBalance.entitlement} days remaining
              </p>
            ) : null}
          </div>

          <div>
            <Label className="mb-1.5 text-xs font-bold">How long?</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant={isSingleDay ? "default" : "outline"}
                disabled={!selectedType}
                onClick={() => handleModeChange("SINGLE")}
              >
                Single day
              </Button>
              <Button
                type="button"
                variant={isSingleDay ? "outline" : "default"}
                disabled={!selectedType}
                onClick={() => handleModeChange("RANGE")}
              >
                Date range
              </Button>
            </div>
          </div>

          {isSingleDay ? (
            <div>
              <Label className="mb-1.5 text-xs font-bold">Date</Label>
              <DatePicker
                value={startDate}
                onChange={handleSingleDateChange}
                disabled={!selectedType}
                min={earliestSelectableDate}
                unavailable={dayOffReason}
              />
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 text-xs font-bold">Start date</Label>
              <DatePicker
                value={startDate}
                disabled={!selectedType}
                min={earliestSelectableDate}
                unavailable={dayOffReason}
                onChange={(next) => {
                  setStartDate(next)
                  // A start after the end is not a range. Dragging the end
                  // along beats rejecting the click the user just made.
                  if (endDate && parseDateString(endDate) < parseDateString(next)) {
                    setEndDate(next)
                  }
                }}
              />
            </div>
            <div>
              <Label className="mb-1.5 text-xs font-bold">End date</Label>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                disabled={!selectedType}
                // The end of a range is never before its start, and never
                // before the backdating window either.
                min={startDate || earliestSelectableDate}
                unavailable={dayOffReason}
              />
            </div>
          </div>
          )}

          {isSingleDay ? (
            <div>
              <Label className="mb-1.5 text-xs font-bold">Duration</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {DURATION_CHOICES.map((choice) => {
                  // Disabled rather than hidden for a whole-days-only type:
                  // an option that silently vanishes when you change type is
                  // its own small confusion, and the caption below teaches
                  // the rule instead.
                  const blocked = choice.value !== "FULL" && !typeAllowsHalfDay
                  return (
                    <Button
                      key={choice.value}
                      type="button"
                      variant={effectiveDuration === choice.value ? "default" : "outline"}
                      disabled={!selectedType || blocked}
                      onClick={() => setDuration(choice.value)}
                    >
                      {choice.label}
                    </Button>
                  )
                })}
              </div>
              {/*
                One caption line, always present so the group never changes
                height. It carries whichever of the three things is worth
                saying: why halves are unavailable, the hours the selected
                choice covers, or how to find those hours out.
              */}
              <p className="mt-1.5 text-xs text-[#5F6B7C]">
                {selectedType && !typeAllowsHalfDay
                  ? `${selectedType.name} leave is taken in whole days.`
                  : halfDayWindow
                    ? DURATION_CHOICES.find((c) => c.value === effectiveDuration)!.window(
                        halfDayWindow
                      )
                    : "Pick a date to see the hours."}
              </p>
            </div>
          ) : null}

          {chargedDays !== null ? (
            <div className="space-y-1">
              <p className="text-[13px] font-semibold">
                {chargedDays} day{chargedDays === 1 ? "" : "s"}{" "}
                <span className="font-normal text-[#5F6B7C]">
                  {countsHolidays
                    ? "(holidays inside the period count as leave)"
                    : "(weekly and public holidays excluded)"}
                </span>
              </p>
              {exceedsBalance ? (
                <p className="text-[12.5px] font-semibold text-[#9A6B10]">
                  That is more than your remaining {selectedBalance?.balance} day
                  {selectedBalance?.balance === 1 ? "" : "s"}. Consider Leave Without Pay instead.
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <Label htmlFor="reason" className="mb-1.5 text-xs font-bold">
              Reason <span className="font-normal text-[#5F6B7C]">(optional)</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {formError ? (
            <p className="text-[13px] font-semibold text-[#B03A3A]">{formError}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="submit"
              disabled={applyMutation.isPending}
              className="bg-[#17191C] text-white hover:bg-[#0E1012]"
            >
              {applyMutation.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
