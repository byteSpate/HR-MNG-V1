"use client"

/**
 * The quarter strip above one person's grid (owner, 2026-10-13): their
 * target for the quarter, what they won, the gap, what is still quoted and
 * open for that quarter, and how many open Opportunities have no quote.
 * Every missing fact is a word, never ৳0 or 0×.
 */

import { TONE } from "@/components/dashboard/record-kit"
import { taka } from "@/components/sales/shared/sales-shared"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { FunnelSummary } from "@/lib/api/types"
import { cn } from "@/lib/utils"

import { coverageText } from "./funnel-labels"

export function QuarterPicker({
  value,
  options,
  onChange,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (next: string) => void
}) {
  const text = options.find((o) => o.value === value)?.label ?? value
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[#5F6B7C]">Quarter</span>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger className="h-8 w-56 text-sm">
          <SelectValue>{() => text}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

const muted = (text: string) => <span className={cn("text-xs", TONE.muted)}>{text}</span>

/** A quarter with nothing won says so in words. ৳0 would read as a result (UI rule 1). */
export const nothingWon = (won: string) => Number(won) === 0

/**
 * One table row, in the same look as the grid under it (owner, 2026-10-13:
 * the funnel stays a table). It scrolls inside its own box on a phone.
 */
export function FunnelSummaryStrip({ summary }: { summary: FunnelSummary }) {
  const coverage = coverageText(summary)
  const heads = ["Quarter", "Target", "Won", "Gap", "Open quoted", "Coverage", "Quotes missing"]
  return (
    <div className="overflow-hidden rounded-lg border border-[#E4E9EF] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm" aria-label={`Targets for ${summary.quarterLabel}`}>
          <thead className="bg-[#F5F7FA] text-xs uppercase tracking-wide text-[#5F6B7C]">
            <tr>
              {heads.map((h, i) => (
                <th key={h} scope="col" className={cn("px-4 py-2 font-medium", i === 0 ? "text-left" : "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-[#EEF1F5]">
              <td className="px-4 py-2.5 font-medium">{summary.quarterLabel}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {summary.target === null ? muted("No target set") : taka(summary.target)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#0B7A3B]">
                {nothingWon(summary.won) ? muted("Nothing won yet") : taka(summary.won)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {summary.gap === null ? muted("No target set") : summary.targetMet ? "Target met" : taka(summary.gap)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {summary.openQuoted === null ? muted("No open quotes") : taka(summary.openQuoted)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{summary.coverage === null ? muted(coverage) : coverage}</td>
              <td
                className={cn(
                  "px-4 py-2.5 text-right tabular-nums",
                  summary.quoteMissingCount > 0 && "font-medium text-[#8A5E0C]"
                )}
              >
                {summary.quoteMissingCount}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
