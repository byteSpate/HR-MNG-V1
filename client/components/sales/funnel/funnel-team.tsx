"use client"

/**
 * The admin's landing screen: one line per person (revision §27.14).
 *
 * Deliberately not a combined grid of everybody's deals. An admin walks one
 * person at a time, which is how the meeting is actually run (§27.17).
 */

import { RiCheckLine } from "@remixicon/react"

import { TONE } from "@/components/dashboard/record-kit"
import { taka } from "@/components/sales/shared/sales-shared"
import type { FunnelTeam } from "@/lib/api/types"
import { cn } from "@/lib/utils"

import { coverageText } from "./funnel-labels"
import { nothingWon } from "./funnel-summary"

interface FunnelTeamListProps {
  team: FunnelTeam
  onOpen: (employeeId: string) => void
}

/** Null means nothing is priced, which is not the same as ৳0. */
function Money({ amount }: { amount: string | null }) {
  return amount === null ? (
    <span className={cn("text-xs", TONE.muted)}>No prices yet</span>
  ) : (
    <>{taka(amount)}</>
  )
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
        Reviewing the week of {team.weekStart}. {walked} of {team.rows.length} walked so far. Targets are for {team.quarterLabel}.
      </p>

      <div className="overflow-hidden rounded-lg border border-[#E4E9EF] bg-white">
        <div className="overflow-x-auto">
          {/* One line per value, so rows stay one height (owner, 2026-10-19). */}
          <table className="w-full min-w-[1200px] border-collapse text-sm [&_td]:whitespace-nowrap">
            <thead className="bg-[#F5F7FA] text-xs uppercase tracking-wide text-[#5F6B7C]">
              <tr>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Person
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Opportunities
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Quoted
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  Still open
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Target</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Won</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Gap</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Open quoted</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Coverage</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Quotes missing</th>
                <th scope="col" className="px-4 py-2 text-left font-medium">
                  Reviewed
                </th>
              </tr>
            </thead>
            <tbody>
              {team.rows.map((row) => (
                // A click anywhere on the row opens this person's funnel; the
                // name is the button, so the keyboard reaches it too.
                <tr
                  key={row.employeeId}
                  onClick={() => onOpen(row.employeeId)}
                  className="cursor-pointer border-t border-[#EEF1F5] hover:bg-[#F5F7FA]"
                >
                  <td className="px-4 py-2.5 font-medium text-[#1B2733]">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(row.employeeId)
                      }}
                      className="text-left hover:underline focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none"
                    >
                      {row.employeeName}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{row.dealCount}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <Money amount={row.quoted} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-[#0B7A3B]">
                    <Money amount={row.stillOpen} />
                  </td>
                  {/* The quarter against the target (owner, 2026-10-13). A missing
                      target is said in words, never as ৳0. */}
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.summary.target === null ? <span className={cn("text-xs", TONE.muted)}>No target set</span> : taka(row.summary.target)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {nothingWon(row.summary.won) ? <span className={cn("text-xs", TONE.muted)}>Nothing won yet</span> : taka(row.summary.won)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row.summary.gap === null ? (
                      <span className={cn("text-xs", TONE.muted)}>—</span>
                    ) : row.summary.targetMet ? (
                      "Target met"
                    ) : (
                      taka(row.summary.gap)
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <Money amount={row.summary.openQuoted} />
                  </td>
                  {/* The small muted text sits in a span, as in the cells beside it, so it shares their baseline. */}
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span className={cn(row.summary.coverage === null && "text-xs " + TONE.muted)}>{coverageText(row.summary)}</span>
                  </td>
                  <td className={cn("px-4 py-2.5 text-right tabular-nums", row.summary.quoteMissingCount > 0 && "font-medium text-[#8A5E0C]")}>
                    {row.summary.quoteMissingCount}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
