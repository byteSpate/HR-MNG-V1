"use client"

/**
 * The grid's four filters, and the two totals (revision §27.9, §27.10).
 *
 * Given to employees as well as admins. A control only one role gets is a
 * control the other role asks for within a week.
 *
 * Every filter here does something the server acts on. There is no search box,
 * because no endpoint behind this page does text search, and a box that
 * silently ignores what you type is a defect rather than a feature.
 */

import { TONE } from "@/components/dashboard/record-kit"
import { taka } from "@/components/sales/shared/sales-shared"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { FunnelQueryOptions, FunnelTotals, OpportunityStatus } from "@/lib/api/types"
import { cn } from "@/lib/utils"

interface FunnelFiltersProps {
  value: FunnelQueryOptions
  onChange: (next: FunnelQueryOptions) => void
  accounts: { id: string; name: string }[]
  /**
   * Absent while a new view is loading or the last request failed. The totals
   * belong to one view; showing the previous view's beside the next one's
   * loading state would read as its answer.
   */
  totals?: FunnelTotals
}

const ALL = "__all__"

/**
 * The wording of both dropdowns, in one place.
 *
 * Base UI's `SelectValue` prints the selected *value* unless it is told what to
 * print, and the value of "no filter" is the `__all__` sentinel — so the closed
 * control read `__all__` while the open list said "Any status". The closed
 * control is given its text explicitly, from the same table the list uses.
 */
const ANY_STATUS = "Any status"
const EVERY_ACCOUNT = "Every account"
const STATUS_OPTIONS: { value: OpportunityStatus; label: string }[] = [
  { value: "ONGOING", label: "Ongoing" },
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "CANCELLED", label: "Cancelled" },
]

/**
 * A total, or the plain fact that there is none. The server sends null when
 * nothing in view is priced, and zero would be a claim nobody made.
 */
function Figure({ amount, className }: { amount: string | null; className: string }) {
  if (amount === null) return <span className={cn("text-sm font-normal", TONE.muted)}>No prices yet</span>
  return <span className={className}>{taka(amount)}</span>
}

export function FunnelFilters({ value, onChange, accounts, totals }: FunnelFiltersProps) {
  const set = (patch: Partial<FunnelQueryOptions>) => onChange({ ...value, ...patch })

  const statusText = STATUS_OPTIONS.find((o) => o.value === value.status)?.label ?? ANY_STATUS
  const accountText = accounts.find((a) => a.id === value.salesAccountId)?.name ?? EVERY_ACCOUNT

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-[#E4E9EF] bg-white px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[#5F6B7C]">Deal status</span>
          <Select
            value={value.status ?? ALL}
            onValueChange={(next) =>
              set({ status: next && next !== ALL ? (next as OpportunityStatus) : undefined })
            }
          >
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue>{() => statusText}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{ANY_STATUS}</SelectItem>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[#5F6B7C]">Account</span>
          <Select
            value={value.salesAccountId ?? ALL}
            onValueChange={(next) => set({ salesAccountId: next && next !== ALL ? next : undefined })}
          >
            <SelectTrigger className="h-8 w-56 text-sm">
              <SelectValue>{() => accountText}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{EVERY_ACCOUNT}</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value.hideClosed)}
            onChange={(e) => set({ hideClosed: e.target.checked })}
            className="size-4 rounded border-[#C9D2DC]"
          />
          Hide lost and cancelled
        </label>

        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input
            type="checkbox"
            checked={Boolean(value.changedLastWeek)}
            onChange={(e) => set({ changedLastWeek: e.target.checked })}
            className="size-4 rounded border-[#C9D2DC]"
          />
          Changed in the last week
        </label>
      </div>

      {/* Two labelled figures, never one (§27.10). A single "Total" would mean
          different things to different readers, because the quoted figure
          includes the deals we lost. */}
      {totals ? (
        <dl className="flex items-end gap-6">
          <div className="text-right">
            <dt className={cn("text-xs", TONE.muted)}>Quoted</dt>
            <dd>
              <Figure
                amount={totals.quoted}
                className="text-base font-semibold tabular-nums text-[#1B2733]"
              />
            </dd>
            <dd className={cn("text-xs", TONE.muted)}>
              {totals.quotedCount} {totals.quotedCount === 1 ? "deal" : "deals"}
            </dd>
          </div>
          <div className="text-right">
            <dt className={cn("text-xs", TONE.muted)}>Still open</dt>
            <dd>
              <Figure
                amount={totals.stillOpen}
                className="text-base font-semibold tabular-nums text-[#0B7A3B]"
              />
            </dd>
            <dd className={cn("text-xs", TONE.muted)}>
              {totals.stillOpenCount} {totals.stillOpenCount === 1 ? "deal" : "deals"}
            </dd>
          </div>
          {/* Said out loud rather than folded into the totals as zero. */}
          {totals.unpricedCount > 0 ? (
            <div className="text-right">
              <dt className={cn("text-xs", TONE.muted)}>No price yet</dt>
              <dd className="text-base font-semibold tabular-nums text-[#8A5E0C]">
                {totals.unpricedCount}
              </dd>
              <dd className={cn("text-xs", TONE.muted)}>in neither figure</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  )
}
