"use client"

/**
 * The funnel grid: the owner's fifteen columns, in the owner's order, under
 * the owner's headings (revision §27.6).
 *
 * The widest table in the app. It scrolls inside its own container so the page
 * body never scrolls sideways.
 */

import { useState } from "react"

import { RiArrowUpSLine, RiErrorWarningLine } from "@remixicon/react"

import { FieldHelp, PanelNotice, TONE } from "@/components/dashboard/record-kit"
import { taka } from "@/components/sales/sales-shared"
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

const STAGE_LABEL: Record<string, string> = {
  REQUIREMENT_RECEIVED: "Requirement received",
  SOLUTION_DESIGN: "Solution design",
  OEM_PRICING: "OEM pricing",
  QUOTATION_SUBMITTED: "Quotation submitted",
  NEGOTIATION: "Negotiation",
  AWAITING_DECISION: "Awaiting decision",
}

const STATUS_TONE: Record<string, string> = {
  ONGOING: "bg-[#EAF2FB] text-[#1F4E79]",
  WON: "bg-[#E6F4EA] text-[#0B7A3B]",
  LOST: "bg-[#FBEAEA] text-[#B03A3A]",
  CANCELLED: "bg-slate-100 text-[#5F6B7C]",
}

/** The five sorts the header offers (§27.9), given to everyone. */
const SORTABLE: Partial<Record<string, FunnelSort>> = {
  date: "offeredOn",
  account: "account",
  amount: "amount",
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
}: FunnelGridProps) {
  const [openRow, setOpenRow] = useState<string | null>(null)

  // A too-narrow filter and a funnel nobody has quoted into are different
  // facts, so they get different sentences.
  if (grid.rows.length === 0) {
    return (
      <div className="rounded-lg border border-[#E4E9EF] bg-white px-6 py-10 text-center">
        {filtersActive ? (
          <>
            <p className="text-sm font-medium text-[#1B2733]">No deals match these filters</p>
            <p className={cn("mt-1 text-sm", TONE.muted)}>
              Deals are quoted, but none of them passes the filters above.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilters}>
              Clear the filters
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-[#1B2733]">Nothing quoted yet</p>
            <p className={cn("mt-1 text-sm", TONE.muted)}>
              A deal joins the funnel when its quotation is submitted, and stays here afterwards.
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
          className="inline-flex items-center gap-1 hover:text-[#1F4E79]"
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
          Showing the first {grid.rows.length} of {grid.totals.quotedCount} deals. The totals cover
          all {grid.totals.quotedCount}. Narrow the filters to see the rest.
        </PanelNotice>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-[#E4E9EF] bg-white">
        {/* The grid scrolls in here. The page body never scrolls sideways. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1800px] border-collapse text-sm">
            <thead className="bg-[#F5F7FA] text-xs uppercase tracking-wide text-[#5F6B7C]">
              <tr>
                {head("sn", "S/N", "w-14 text-center")}
                {head("date", "Date", "w-28")}
                {head("account", "Account", "w-48")}
                <th scope="col" className="w-48 px-2 py-2 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    Project Name
                    {/* The business calls it this; the field is the deal's own
                        name and no Project table exists (§27.6). */}
                    <FieldHelp label="Project Name">
                      The deal&apos;s name. It is called Project Name on the funnel sheet, so the
                      heading is kept — but there is no separate project record behind it.
                    </FieldHelp>
                  </span>
                </th>
                {head("useCase", "Use Case", "w-44")}
                {head("brand", "Brand", "w-32")}
                {head("model", "Model", "w-32")}
                {head("qty", "Qty", "w-20")}
                {head("amount", "Amount", "w-32 text-right")}
                {head("status", "Deal Status", "w-32")}
                {head("stage", "Stage", "w-40")}
                {head("closing", "Tentative Closing", "w-36")}
                {head("lostTo", "Lost To", "w-52")}
                {head("nextStep", "Next Step", "w-52")}
                {head("remarks", "Remarks", "w-64")}
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
}: {
  row: FunnelRow
  editable: boolean
  open: boolean
  onToggle: () => void
  onEdit: (opportunityId: string, field: FunnelCellField, value: string | null) => Promise<void>
  canAddManagementNote: boolean
  onAddManagementNote: (opportunityId: string, body: string) => Promise<void>
}) {
  const save = (field: FunnelCellField) => (value: string | null) =>
    onEdit(row.opportunityId, field, value)

  return (
    <>
      <tr className="border-t border-[#EEF1F5] align-top hover:bg-[#FAFBFC]">
        <td className="px-2 py-1.5 text-center tabular-nums text-[#5F6B7C]">{row.serialNo}</td>

        <td className="px-1 py-1.5">
          <FunnelCell
            value={row.offeredOn}
            editable={editable}
            type="date"
            // A quoted deal keeps its offer date: it can change, not go blank.
            clearable={false}
            onSave={save("offeredOn")}
          />
        </td>

        <td className="px-2 py-1.5">
          <button type="button" onClick={onToggle} className="text-left hover:underline">
            <span className="block truncate font-medium text-[#1B2733]">{row.accountName}</span>
            <span className={cn("block text-xs tabular-nums", TONE.muted)}>{row.serial}</span>
          </button>
        </td>

        <td className="px-2 py-1.5">
          <span className="block truncate">{row.projectName}</span>
        </td>

        <td className="px-1 py-1.5">
          <FunnelCell
            value={row.useCase}
            editable={editable}
            placeholder="Add"
            onSave={save("useCase")}
          />
        </td>

        {/* Brand, Model and Qty are summarised from the deal's lines and are
            edited on the deal itself, not here (§27.6). */}
        <td className="px-2 py-1.5">
          <span className="block truncate">
            {row.brand || <span className={TONE.muted}>—</span>}
          </span>
        </td>
        <td className="px-2 py-1.5">
          <span className="block truncate">
            {row.model || <span className={TONE.muted}>—</span>}
          </span>
        </td>
        <td className="px-2 py-1.5 tabular-nums">
          {row.quantity || <span className={TONE.muted}>—</span>}
        </td>

        <td className="px-1 py-1.5">
          <FunnelCell
            value={row.amount}
            display={row.amount ? taka(row.amount) : ""}
            editable={editable}
            type="money"
            align="right"
            placeholder="No price"
            onSave={save("amount")}
          />
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

        <td className="px-2 py-1.5 text-xs text-[#5F6B7C]">
          {STAGE_LABEL[row.stage] ?? row.stage}
        </td>

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
                className="size-4 shrink-0 text-[#B03A3A]"
                aria-label={`Pushed back from ${row.previousClosingDate ?? "an earlier date"}`}
              />
            ) : null}
          </div>
        </td>

        <td className="px-1 py-1.5">
          {row.status === "LOST" ? (
            <div className="space-y-0.5">
              <FunnelCell
                value={row.lostTo.partner}
                editable={editable}
                placeholder="Who won it"
                onSave={save("lostToPartner")}
              />
              <FunnelCell
                value={row.lostTo.amount}
                display={row.lostTo.amount ? taka(row.lostTo.amount) : ""}
                editable={editable}
                type="money"
                placeholder="At what price"
                onSave={save("lostToAmount")}
              />
              <FunnelCell
                value={row.lostTo.product}
                editable={editable}
                placeholder="With what"
                onSave={save("lostToProduct")}
              />
            </div>
          ) : (
            // Asked for only when a deal is lost (§27.4). Three empty boxes on
            // every live deal would read as work somebody owes.
            <span className={TONE.muted}>—</span>
          )}
        </td>

        <td className="px-1 py-1.5">
          <FunnelCell
            value={row.nextStep}
            editable={editable}
            placeholder="Add"
            onSave={save("nextStep")}
          />
        </td>

        <td className="px-2 py-1.5">
          <button type="button" onClick={onToggle} className="block w-full text-left">
            {row.offerLine ? (
              <span className="block truncate text-xs text-[#1B2733]">{row.offerLine}</span>
            ) : null}
            {row.remarks.length > 0 ? (
              <span className={cn("block truncate text-xs", TONE.muted)}>
                {row.remarks[0].body}
                {row.remarks.length > 1 ? ` +${row.remarks.length - 1} more` : ""}
              </span>
            ) : (
              <span className={cn("block text-xs", TONE.muted)}>No remarks</span>
            )}
          </button>
        </td>
      </tr>

      {open ? (
        <tr className="border-t border-[#EEF1F5] bg-[#FAFBFC]">
          <td colSpan={15} className="px-4 py-3">
            <FunnelRowDetail
              row={row}
              canAddManagementNote={canAddManagementNote}
              onAddManagementNote={onAddManagementNote}
            />
          </td>
        </tr>
      ) : null}
    </>
  )
}
