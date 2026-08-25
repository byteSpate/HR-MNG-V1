"use client"

import { useMemo } from "react"

import { Calendar } from "@/components/ui/calendar"
import type { AttendanceDay, HolidayItem } from "@/lib/api/types"
import { parseDateString } from "@/lib/utils"
import { HOLIDAY_TYPE_LABEL, formatDayLabel } from "@/components/attendance/attendance-shared"

const LEGEND = [
  { key: "present", label: "Present", swatch: "#1E7A3C" },
  { key: "late", label: "Late", swatch: "#9A6B10" },
  { key: "absent", label: "Absent", swatch: "#B03A3A" },
  { key: "leave", label: "On leave", swatch: "#3E6DB5" },
  { key: "holiday", label: "Holiday", swatch: "#7A8698" },
  { key: "off", label: "Weekly off", swatch: "#C3C9D2" },
] as const

export function AttendanceCalendar({
  days,
  holidays,
  month,
  year,
}: {
  days: AttendanceDay[]
  holidays: HolidayItem[]
  month: number
  year: number
}) {
  const modifiers = useMemo(() => {
    const pick = (fn: (d: AttendanceDay) => boolean) =>
      days.filter(fn).map((d) => parseDateString(d.date))

    return {
      // Late is checked first so a late day paints as late, not as plain
      // present — the more specific signal wins.
      late: pick((d) => d.status === "PRESENT" && d.isLate),
      present: pick((d) => d.status === "PRESENT" && !d.isLate),
      absent: pick((d) => d.status === "ABSENT"),
      leave: pick((d) => d.status === "ON_LEAVE"),
      holiday: pick((d) => d.status === "HOLIDAY"),
      off: pick((d) => d.status === "WEEKLY_OFF"),
    }
  }, [days])

  const monthHolidays = holidays.filter((h) => {
    const d = parseDateString(h.date)
    return d.getMonth() + 1 === month && d.getFullYear() === year
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <div className="rounded-md border border-[#E4E9EF] bg-white p-4">
        <Calendar
          mode="single"
          month={new Date(year, month - 1, 1)}
          modifiers={modifiers}
          modifiersClassNames={{
            present: "bg-[#E3F3E8] text-[#1E7A3C] font-bold rounded",
            late: "bg-[#FBF0D9] text-[#9A6B10] font-bold rounded",
            absent: "bg-[#FBE4E4] text-[#B03A3A] font-bold rounded",
            leave: "bg-[#E4EBF7] text-[#3E6DB5] font-bold rounded",
            holiday: "bg-[#ECEEF1] text-[#3D4756] font-bold rounded",
            off: "text-[#B6BDC6]",
          }}
          // Navigation is driven by the page's month switcher, so the
          // calendar's own nav would be a second source of truth. That is also
          // why this one keeps the static caption while every input picker
          // defaults to dropdowns — a disabled dropdown is worse than no
          // dropdown, and there is nothing here for it to navigate.
          captionLayout="label"
          disableNavigation
          showOutsideDays={false}
        />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[#EEF1F5] pt-3">
          {LEGEND.map((item) => (
            <div key={item.key} className="flex items-center gap-1.5 text-[11.5px] text-[#5F6B7C]">
              <span
                className="size-2.5 rounded-full"
                style={{ background: item.swatch }}
                aria-hidden="true"
              />
              {item.label}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-[#E4E9EF] bg-white p-5.5">
        <div className="text-[13px] font-bold">Holidays this month</div>
        {monthHolidays.length === 0 ? (
          <div className="mt-2 text-[12.5px] text-[#5F6B7C]">No holidays this month.</div>
        ) : (
          <ul className="mt-2.5 space-y-2">
            {monthHolidays.map((holiday) => (
              <li key={holiday.id} className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-semibold">{holiday.name}</span>
                <span className="shrink-0 text-[11.5px] text-[#5F6B7C]">
                  {formatDayLabel(holiday.date)}
                  {holiday.type !== "GENERAL" ? ` · ${HOLIDAY_TYPE_LABEL[holiday.type]}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
