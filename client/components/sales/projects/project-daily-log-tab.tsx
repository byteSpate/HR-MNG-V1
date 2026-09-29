"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { getProjectDailyLog } from "@/lib/api/sales/projects"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { ProjectSummary } from "@/lib/api/types"
import { TONE } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * The Project's Daily Log, one week at a time (spec §2.2).
 *
 * Read-only here on purpose: a team member writes their line in their own
 * Weekly Report, which is the same place they write everything else about
 * their week. This screen is the Project Manager reading what came back.
 */
export function ProjectDailyLogTab({ project }: { project: ProjectSummary }) {
  const { accessToken } = useSession()
  const [week, setWeek] = useState<string | null>(null)

  const log = useQuery({
    queryKey: salesKeys.projectDailyLog(project.id, week),
    queryFn: () => getProjectDailyLog(accessToken!, project.id, week ?? undefined),
    enabled: !!accessToken,
  })

  const currentWeek = log.data?.weekStart ?? null
  const atCurrent = week === null || week === currentWeek

  if (project.team.length === 0) {
    return (
      <p className="text-[13px]">
        No one is on the team yet, so there is no Daily Log.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => setWeek(currentWeek ? addDays(currentWeek, -7) : null)}
          className="h-8 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
        >
          Previous week
        </Button>
        <Button
          type="button"
          onClick={() => setWeek(null)}
          className="h-8 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
        >
          This week
        </Button>
        <Button
          type="button"
          // Next week has no lines yet, so there is nothing to look at.
          disabled={atCurrent}
          onClick={() => currentWeek && setWeek(addDays(currentWeek, 7))}
          className="h-8 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB] disabled:opacity-50"
        >
          Next week
        </Button>
      </div>

      {log.isPending ? (
        <p className={`text-[13px] ${TONE.muted}`}>Loading the week…</p>
      ) : log.isError ? (
        <p className="text-[13px] font-semibold text-[#B03A3A]">
          The Daily Log could not be loaded.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-[#E4E9EF]">
                <th className="py-2 pr-3 text-[11.5px] font-semibold text-[#5F6B7C]">Person</th>
                {(log.data?.days ?? []).map((day) => (
                  <th key={day.date} className="py-2 pr-3 text-[11.5px] font-semibold text-[#5F6B7C]">
                    {new Date(`${day.date}T00:00:00.000Z`).toLocaleDateString("en-GB", {
                      day: "2-digit", month: "short",
                    })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(log.data?.days ?? []).length > 0 && log.data!.days[0].people.map((_, index) => {
                const person = log.data!.days[0].people[index]
                return (
                  <tr key={person.employeeId} className="border-b border-[#EEF1F5] align-top">
                    <td className="py-2 pr-3 text-[13px] font-semibold">{person.fullName}</td>
                    {log.data!.days.map((day) => {
                      const cell = day.people.find((p) => p.employeeId === person.employeeId)
                      if (!cell) return <td key={day.date} className="py-2 pr-3" />
                      return (
                        <td
                          key={day.date}
                          className={`py-2 pr-3 text-[12.5px] ${cell.missing ? "text-[#8A5E0C]" : ""}`}
                        >
                          {cell.text ? (
                            cell.text
                          ) : cell.noWork ? (
                            <span className={TONE.muted}>No work</span>
                          ) : cell.label ? (
                            <span className={TONE.muted}>{cell.label}</span>
                          ) : cell.missing ? (
                            <span className="font-semibold">No Daily Log</span>
                          ) : (
                            <span className={TONE.muted}>Nothing yet</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className={`text-[12px] ${TONE.muted}`}>
        Team members write this in their Weekly Report, one line a day for each Project in progress.
      </p>
    </div>
  )
}
