"use client"

/**
 * The admin's landing screen: one line per person (revision §27.14).
 *
 * Deliberately not a combined grid of everybody's deals. An admin walks one
 * person at a time, which is how the meeting is actually run (§27.17).
 */

import { RiArrowRightLine, RiCheckLine } from "@remixicon/react"

import { TONE } from "@/components/dashboard/record-kit"
import { taka } from "@/components/sales/sales-shared"
import type { FunnelTeam } from "@/lib/api/types"
import { cn } from "@/lib/utils"

interface FunnelTeamListProps {
  team: FunnelTeam
  onOpen: (employeeId: string) => void
}

export function FunnelTeamList({ team, onOpen }: FunnelTeamListProps) {
  if (team.rows.length === 0) {
    return (
      <div className="rounded-lg border border-[#E4E9EF] bg-white px-6 py-10 text-center">
        <p className="text-sm font-medium text-[#1B2733]">Nobody is in the Sales Hub yet</p>
        <p className={cn("mt-1 text-sm", TONE.muted)}>
          Give somebody a sales role and their funnel will appear here.
        </p>
      </div>
    )
  }

  const walked = team.rows.filter((row) => row.reviewed).length

  return (
    <div className="space-y-3">
      <p className={cn("text-sm", TONE.muted)}>
        Reviewing the week of {team.weekStart}. {walked} of {team.rows.length} walked so far.
      </p>

      <div className="overflow-hidden rounded-lg border border-[#E4E9EF] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead className="bg-[#F5F7FA] text-xs uppercase tracking-wide text-[#5F6B7C]">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Person
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Deals
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Quoted
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Still open
                </th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Reviewed
                </th>
                <th scope="col" className="w-24 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {team.rows.map((row) => (
                <tr key={row.employeeId} className="border-t border-[#EEF1F5] hover:bg-[#FAFBFC]">
                  <td className="px-4 py-2.5 font-medium text-[#1B2733]">{row.employeeName}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.dealCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{taka(row.quoted)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#0B7A3B]">
                    {taka(row.stillOpen)}
                  </td>
                  <td className="px-4 py-2.5">
                    {row.reviewed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#E6F4EA] px-2 py-0.5 text-xs font-medium text-[#0B7A3B]">
                        <RiCheckLine className="size-3.5" aria-hidden />
                        Walked
                      </span>
                    ) : (
                      // Not a red warning: a funnel not yet walked on Saturday
                      // morning is the normal state, not a failure.
                      <span className={cn("text-xs", TONE.muted)}>Not yet</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onOpen(row.employeeId)}
                      className="inline-flex items-center gap-1 text-sm font-medium text-[#1F4E79] hover:underline"
                    >
                      Open
                      <RiArrowRightLine className="size-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
