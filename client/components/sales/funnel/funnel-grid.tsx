"use client"

/**
 * The funnel grid (revision §27.6), slimmed to quotes and targets (owner,
 * 2026-10-13). Use Case, the product lines, Stage, Lost To, Next Step and
 * Remarks moved into the row detail; the grid keeps what an admin reads at a
 * glance.
 *
 * The widest table in the app. It scrolls inside its own container so the page
 * body never scrolls sideways.
 */

import { useState } from "react"

import { RiAddLine, RiArrowUpSLine, RiErrorWarningLine } from "@remixicon/react"

import { FieldHelp, PanelNotice, TONE } from "@/components/dashboard/record-kit"
import { daysLeftText, FUNNEL_NAME_HEADING, FUNNEL_NAME_HELP } from "./funnel-labels"
import { longDay } from "@/lib/quotes"
import { taka } from "@/components/sales/shared/sales-shared"
import { Button } from "@/components/ui/button"
import type { FunnelCellField, FunnelGrid, FunnelRow, FunnelSort } from "@/lib/api/types"
import { cn } from "@/lib/utils"

import { FunnelCell } from "./funnel-cell"
import { FunnelRowDetail } from "./funnel-row-detail"

const STATUS_LABEL: Record<string, string> = {
  ONGOING: "Ongoing",
  WON: "Won",
  LOST: "Lost",
  CANCELLED: "Cancelled",
}

const STATUS_TONE: Record<string, string> = {
  ONGOING: "bg-info-tint text-info-ink",
  WON: "bg-success-tint text-success",
  LOST: "bg-warning-tint text-danger",
  CANCELLED: "bg-slate-100 text-ink-muted",
}

/** The five sorts the header offers (§27.9), given to everyone. The Quote
    column sorts by the Opportunity value, which is the latest quote. */
const SORTABLE: Partial<Record<string, FunnelSort>> = {
  date: "offeredOn",
  account: "account",
  quote: "amount",
  status: "status",
  closing: "expectedCloseDate",
}

interface FunnelGridProps {
  grid: FunnelGrid
  /** False when the viewer may read the row but not change it. */
  editable: boolean
  sort: FunnelSort
  direction: "asc" | "desc"
  onSort: (sort: FunnelSort) => void
  onEdit: (opportunityId: string, field: FunnelCellField, value: string | null) => Promise<void>
  canAddManagementNote: boolean
  onAddManagementNote: (opportunityId: string, body: string) => Promise<void>
  /**
   * Whether any filter is narrowing the view. An empty grid means two
   * different things depending on it, and the caller is the one who knows.
   */
  filtersActive: boolean
  onClearFilters: () => void
  /**
   * Open take-outs for each Opportunity, by id (owner, 2026-11-02): how many
   * there are and the words of the newest. Absent leaves the column out.
   */
  takeOuts?: Record<string, { count: number; latest: string }>
  /** Opens the Opportunity in the side panel, where a take-out can be given. */
  onOpenPanel?: (opportunityId: string) => void
}

export function FunnelGridTable({
  grid,
  editable,
  sort,
  direction,
  onSort,
  onEdit,
  canAddManagementNote,
  onAddManagementNote,
  filtersActive,
  onClearFilters,
  takeOuts,
  onOpenPanel,
}: FunnelGridProps) {
  const [openRow, setOpenRow] = useState<string | null>(null)

  // A too-narrow filter and a funnel nobody has quoted into are different
  // facts, so they get different sentences.
  if (grid.rows.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-white px-6 py-10 text-center">
        {filtersActive ? (
          <>
            <p className="text-sm font-medium text-ink-body">No Opportunities match these filters</p>
            <p className={cn("mt-1 text-sm", TONE.muted)}>
              Opportunities are quoted, but none of them passes the filters above.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilters}>
              Clear the filters
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-ink-body">Nothing quoted yet</p>
            <p className={cn("mt-1 text-sm", TONE.muted)}>
              An Opportunity joins the funnel when its quotation is submitted, and stays here afterwards.
            </p>
          </>
        )}
      </div>
    )
  }

  const head = (key: string, label: string, extra?: string) => {
    const target = SORTABLE[key]
    if (!target) {
      return (
        <th scope="col" className={cn("px-2 py-2 text-left font-medium", extra)}>
          {label}
        </th>
      )
    }
    const active = sort === target
    return (
      <th
        scope="col"
        aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
        className={cn("px-2 py-2 text-left font-medium", extra)}
      >
        <button
          type="button"
          onClick={() => onSort(target)}
          className="inline-flex items-center gap-1 hover:text-info-ink"
        >
          {label}
          {active ? (
            <RiArrowUpSLine
              className={cn("size-3.5 transition-transform", direction === "desc" && "rotate-180")}
              aria-hidden
            />
          ) : null}
        </button>
      </th>
    )
  }

  return (
    <div className="space-y-3">
      {/* The rows are the first page of a longer view, while the totals above
          add up all of it. Two numbers that disagree with no explanation would
          read as a bug, so the page says which is which. */}
      {grid.truncated ? (
        <PanelNotice>
          Showing the first {grid.rows.length} of {grid.totals.quotedCount} Opportunities. The totals cover
          all {grid.totals.quotedCount}. Narrow the filters to see the rest.
        </PanelNotice>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        {/* The grid scrolls in here. The page body never scrolls sideways. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-325 border-collapse text-sm">
            <thead className="bg-surface-subtle text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                {head("sn", "S/N", "w-14 text-center")}
                {head("date", "Date", "w-28")}
                {head("account", "Account", "w-48")}
                <th scope="col" className="w-48 px-2 py-2 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    {FUNNEL_NAME_HEADING}
                    <FieldHelp label={FUNNEL_NAME_HEADING}>{FUNNEL_NAME_HELP}</FieldHelp>
                  </span>
                </th>
                {head("owner", "Owner", "w-36")}
                {head("quote", "Quote", "w-40 text-right")}
                {head("changes", "Quote changes", "w-24 text-right")}
                {head("quarter", "Quarter", "w-24")}
                {head("closing", "Tentative Closing", "w-36")}
                {head("daysLeft", "Days left", "w-32")}
                {head("since", "Days since quoted", "w-28 text-right")}
                {head("status", "Opportunity Status", "w-32")}
                {onOpenPanel ? head("takeouts", "Take-outs", "w-40") : null}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <FunnelGridRow
                  key={row.opportunityId}
                  row={row}
                  editable={editable}
                  open={openRow === row.opportunityId}
                  onToggle={() =>
                    setOpenRow(openRow === row.opportunityId ? null : row.opportunityId)
                  }
                  onEdit={onEdit}
                  canAddManagementNote={canAddManagementNote}
                  onAddManagementNote={onAddManagementNote}
                  takeOut={takeOuts?.[row.opportunityId]}
                  onOpenPanel={onOpenPanel}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function FunnelGridRow({
  row,
  editable,
  open,
  onToggle,
  onEdit,
  canAddManagementNote,
  onAddManagementNote,
  takeOut,
  onOpenPanel,
}: {
  row: FunnelRow
  editable: boolean
  open: boolean
  onToggle: () => void
  onEdit: (opportunityId: string, field: FunnelCellField, value: string | null) => Promise<void>
  canAddManagementNote: boolean
  onAddManagementNote: (opportunityId: string, body: string) => Promise<void>
  takeOut?: { count: number; latest: string }
  onOpenPanel?: (opportunityId: string) => void
}) {
  const save = (field: FunnelCellField) => (value: string | null) =>
    onEdit(row.opportunityId, field, value)

  return (
    <>
      <tr className="border-t border-surface-sunken align-top hover:bg-surface-subtle">
        <td className="px-2 py-1.5 text-center tabular-nums text-ink-muted">{row.serialNo}</td>

        {/* The Funnel date is Quote 1's date, so it changes with the quote, not here. */}
        <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">
          {row.offeredOn ? longDay(row.offeredOn) : <span className={TONE.muted}>—</span>}
        </td>

        <td className="px-2 py-1.5">
          <button type="button" onClick={onToggle} className="text-left hover:underline pointer-coarse:py-3">
            <span className="block truncate font-medium text-ink-body">{row.accountName}</span>
            <span className={cn("block text-xs tabular-nums", TONE.muted)}>{row.serial}</span>
          </button>
        </td>

        <td className="px-2 py-1.5">
          <span className="block truncate">{row.projectName}</span>
        </td>

        <td className="px-2 py-1.5">
          <span className="block truncate">{row.ownerName}</span>
        </td>

        {/* The latest quote; the detail below lists them all. */}
        <td className="px-2 py-1.5 text-right">
          <button type="button" onClick={onToggle} className="block w-full text-right hover:underline">
            {row.latestQuote ? (
              <>
                <span className="block font-medium tabular-nums text-ink-body">{taka(row.latestQuote.amount)}</span>
                <span className={cn("block text-xs whitespace-nowrap", TONE.muted)}>
                  {longDay(row.latestQuote.quotedOn)} · Quote {row.quoteCount}
                </span>
              </>
            ) : (
              <>
                <span className={cn("block", TONE.muted)}>No price yet</span>
                <span className="mt-0.5 inline-block rounded-full bg-warning-tint px-2 py-0.5 text-caption font-medium whitespace-nowrap text-warning">
                  Quote missing
                </span>
              </>
            )}
          </button>
        </td>

        <td className="px-2 py-1.5 text-right tabular-nums">{row.quoteChanges}</td>

        <td className="px-2 py-1.5">{row.quarterLabel ?? <span className={TONE.muted}>—</span>}</td>

        <td className="px-1 py-1.5">
          <div className="flex items-center gap-1">
            <FunnelCell
              value={row.closingDate}
              display={row.closingDateLabel}
              editable={editable}
              type="date"
              placeholder="Not set"
              onSave={save("expectedCloseDate")}
            />
            {/* The sheet's red date, derived from the audit log (§27.15). */}
            {row.closingDateSlipped ? (
              <RiErrorWarningLine
                className="size-4 shrink-0 text-danger"
                aria-label={`Pushed back from ${row.previousClosingDate ?? "an earlier date"}`}
              />
            ) : null}
          </div>
        </td>

        <td className={cn("px-2 py-1.5 whitespace-nowrap tabular-nums", row.daysLeft !== null && row.daysLeft < 0 ? "font-medium text-danger" : row.daysLeft === null ? TONE.muted : undefined)}>
          {daysLeftText(row.daysLeft)}
        </td>

        <td className="px-2 py-1.5 text-right tabular-nums">
          {row.daysSinceQuoted ?? <span className={TONE.muted}>—</span>}
        </td>

        <td className="px-2 py-1.5">
          <span
            className={cn(
              "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
              STATUS_TONE[row.status]
            )}
          >
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
        </td>

        {/* One tap opens the side panel: the count and the newest words of the
            open take-outs, and a way to give another (owner, 2026-11-02). */}
        {onOpenPanel ? (
          <td className="px-2 py-1.5">
            <div className="flex min-w-[7.5rem] flex-col items-start gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenPanel(row.opportunityId)}
                className="whitespace-nowrap"
              >
                <RiAddLine aria-hidden="true" className="size-3.5" />
                Take-out
              </Button>
              {takeOut ? (
                <span className={cn("block max-w-[9rem] truncate text-xs", TONE.muted)}>
                  {takeOut.count === 1 ? "1 open" : `${takeOut.count} open`}: {takeOut.latest}
                </span>
              ) : null}
            </div>
          </td>
        ) : null}
      </tr>

      {open ? (
        <tr className="border-t border-surface-sunken bg-surface-subtle">
          <td colSpan={13} className="px-4 py-3">
            <FunnelRowDetail
              row={row}
              editable={editable}
              onEdit={onEdit}
              canAddManagementNote={canAddManagementNote}
              onAddManagementNote={onAddManagementNote}
            />
          </td>
        </tr>
      ) : null}
    </>
  )
}
