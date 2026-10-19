import type { ReactNode } from "react"
import Link from "next/link"
import {
  RiArchiveLine,
  RiCalendarCheckLine,
  RiFileList3Line,
  RiInboxLine,
  RiMoneyDollarCircleLine,
  RiShieldUserLine,
  RiTeamLine,
  RiToolsLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import { Tag } from "@/components/dashboard/tag"
import type { SubpageData, TableCell } from "@/components/dashboard/types"

/**
 * `AuditEntity` names to glyphs. Deliberately partial: an entity with no entry
 * renders no icon, so adding one server-side degrades to the old look instead
 * of to a question-mark box.
 */
const CELL_ICONS: Record<string, RemixiconComponentType> = {
  ASSET: RiArchiveLine,
  ASSET_ASSIGNMENT: RiArchiveLine,
  ASSET_REQUEST: RiInboxLine,
  ASSET_REPAIR: RiToolsLine,
  ASSET_RECOVERY: RiMoneyDollarCircleLine,
  PAYROLL_RUN: RiMoneyDollarCircleLine,
  PAYSLIP: RiFileList3Line,
  EMPLOYEE: RiTeamLine,
  USER: RiShieldUserLine,
  ATTENDANCE: RiCalendarCheckLine,
  LEAVE_REQUEST: RiCalendarCheckLine,
  EXPENSE_CLAIM: RiMoneyDollarCircleLine,
}

/** The inner content of one cell, without any row or card chrome around it. */
function CellBody({ cell }: { cell: TableCell }) {
  if (cell.node) return <>{cell.node}</>
  if (cell.tag) return <Tag label={cell.tag} tone={cell.tone ?? "neutral"} />
  const Icon = cell.icon ? CELL_ICONS[cell.icon] : undefined
  return (
    <div className="min-w-0">
      <div
        className="flex items-center gap-1.5 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap"
        style={{ fontWeight: cell.weight ?? 400, color: "#1C2733" }}
      >
        {Icon ? <Icon className="size-4 shrink-0 text-[#8A94A2]" aria-hidden /> : null}
        <span className="truncate">{cell.text}</span>
      </div>
      {/* `#6B7789`, not the old `#A5AFBE`: that was 2.2:1 against white, which
          is unreadable rather than quiet. This is the same grey one shade down,
          at 4.5:1. */}
      {cell.sub ? (
        <div className="mt-0.5 overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-[#6B7789]">
          {cell.sub}
        </div>
      ) : null}
    </div>
  )
}

/** A cell carrying nothing at all — rendered, it would be an orphan label. */
const isEmpty = (cell: TableCell) => !cell.text && !cell.tag && !cell.node

/**
 * A link stretched over the whole row or card (owner, 2026-10-18), so a click
 * anywhere opens the record. It is a real link, so a right-click or Ctrl+click
 * still opens a new tab. Buttons inside the row sit above it (`relative z-10`,
 * as RowActions does), so they keep their own job.
 */
function RowLink({ href, row }: { href: string; row: TableCell[] }) {
  return (
    <Link
      href={href}
      aria-label={`Open ${row[0]?.text ?? "this row"}`}
      className="absolute inset-0 rounded-md focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none"
    />
  )
}

export function DataTable({
  title,
  cols,
  headers,
  rows,
  action = "Export",
  actionHref,
  rowHrefs,
  headerNodes,
}: Pick<SubpageData, "cols" | "headers" | "rows"> & {
  /** Rich headers for the wide table, like sort buttons. `headers` still labels the phone cards. */
  headerNodes?: ReactNode[]
  /** One link per row, the same length as `rows`. Given, the whole row opens it. */
  rowHrefs?: (string | null)[]
  title: string
  action?: string
  /** Makes the action label navigate. Without it the label stays inert text,
      which is what every existing caller expects. */
  actionHref?: string
}) {
  return (
    <div className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
      {/* Callers that own their own heading (the settings panels, four of the
          attendance sections) pass both of these empty. Rendering the row
          anyway left an empty 15px bar plus its margin above the table. */}
      {title || action ? (
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <div className="text-[15px] font-bold">{title}</div>
          {actionHref ? (
            <Link
              href={actionHref}
              className="shrink-0 text-[12.5px] font-semibold hover:underline"
            >
              {action}
            </Link>
          ) : (
            <span className="shrink-0 text-[12.5px] font-semibold">{action}</span>
          )}
        </div>
      ) : null}

      {/* md and up: the aligned grid. It iterates `rows.flat()` because the
          grid is one flat list of tracks.

          Stretched, not `items-center`. Each cell draws its own bottom border,
          so centring them made every box only as tall as its own content and
          parked that border wherever the content happened to end — a two-line
          cell ruled lower than a one-line one, and an empty header ruled
          highest of all. The row's dividers came out as a staircase. Stretching
          gives every cell in a row the same height; the inner `flex
          items-center` keeps the content vertically centred as before. */}
      <div className="hidden gap-x-3.5 md:grid" style={{ gridTemplateColumns: cols }}>
        {headers.map((header, i) => (
          // Indexed key: more than one header can be blank, and `key={header}`
          // makes those collide.
          <div
            key={`${header}-${i}`}
            className="flex items-end border-b border-[#E4E9EF] py-2.5 text-[11px] font-bold tracking-wide text-[#5F6B7C] uppercase"
          >
            {headerNodes?.[i] ?? header}
          </div>
        ))}
        {rowHrefs
          ? rows.map((row, r) => (
              // A subgrid row, so the row has a box to hover and to link,
              // while its cells still line up with the header tracks.
              <div key={r} className="relative col-span-full grid grid-cols-subgrid hover:bg-[#F7F9FB]">
                {rowHrefs[r] ? <RowLink href={rowHrefs[r]!} row={row} /> : null}
                {row.map((cell, c) => (
                  <div key={c} className="flex min-w-0 items-center border-b border-[#EEF1F5] py-3">
                    <div className="min-w-0 flex-1">
                      <CellBody cell={cell} />
                    </div>
                  </div>
                ))}
              </div>
            ))
          : rows.flat().map((cell, i) => (
              <div key={i} className="flex min-w-0 items-center border-b border-[#EEF1F5] py-3">
                <div className="min-w-0 flex-1">
                  <CellBody cell={cell} />
                </div>
              </div>
            ))}
      </div>

      {/* Below md: one card per row, so nobody swipes sideways to read a
          record. Iterates `rows` un-flattened — a card needs its row bounds.
          The first cell becomes the card title; the rest become label/value
          pairs, the label coming from the header at the same index. */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row, r) => (
          <div key={r} className={`relative rounded-md border border-[#EEF1F5] p-3 ${rowHrefs?.[r] ? "hover:bg-[#F7F9FB]" : ""}`}>
            {rowHrefs?.[r] ? <RowLink href={rowHrefs[r]!} row={row} /> : null}
            {row[0] && !isEmpty(row[0]) ? (
              <div className="mb-2 border-b border-[#EEF1F5] pb-2">
                <CellBody cell={row[0]} />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {row.slice(1).map((cell, c) => {
                if (isEmpty(cell)) return null
                return (
                  <div key={c} className="flex items-start justify-between gap-3">
                    {/* `c + 1`, not `c`: slice(1) dropped the title cell. */}
                    <span className="shrink-0 pt-px text-[10.5px] font-bold tracking-wide text-[#5F6B7C] uppercase">
                      {headers[c + 1]}
                    </span>
                    <div className="min-w-0 text-right">
                      <CellBody cell={cell} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
