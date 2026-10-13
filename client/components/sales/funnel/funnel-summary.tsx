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

function Tile({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[#E4E9EF] bg-white px-3 py-2.5">
      <dt className={cn("text-xs", TONE.muted)}>{label}</dt>
      <dd className={cn("mt-0.5 text-base font-semibold tabular-nums [overflow-wrap:anywhere]", tone)}>{children}</dd>
    </div>
  )
}

const muted = (text: string) => <span className={cn("text-sm font-normal", TONE.muted)}>{text}</span>

export function FunnelSummaryStrip({ summary }: { summary: FunnelSummary }) {
  const coverage = coverageText(summary)
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label={`Targets for ${summary.quarterLabel}`}>
      <Tile label="Target">{summary.target === null ? muted("No target set") : taka(summary.target)}</Tile>
      <Tile label="Won" tone="text-[#0B7A3B]">{taka(summary.won)}</Tile>
      <Tile label="Gap">
        {summary.gap === null ? muted("No target set") : summary.targetMet ? "Target met" : taka(summary.gap)}
      </Tile>
      <Tile label="Open quoted">{summary.openQuoted === null ? muted("No open quotes") : taka(summary.openQuoted)}</Tile>
      <Tile label="Coverage">{summary.coverage === null ? muted(coverage) : coverage}</Tile>
      <Tile label="Quotes missing" tone={summary.quoteMissingCount > 0 ? "text-[#8A5E0C]" : undefined}>
        {summary.quoteMissingCount}
      </Tile>
    </dl>
  )
}
