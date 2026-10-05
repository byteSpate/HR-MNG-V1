"use client"

import { useState } from "react"
import Link from "next/link"
import { RiArrowDownSLine, RiArrowRightSLine } from "@remixicon/react"

import type { StatementLine } from "@/lib/api/types"
import { taka, takaTotal } from "@/components/statements/statements-shared"
import { cn } from "@/lib/utils"

/**
 * A statement line. Clicking one with a breakdown expands it in place into
 * its constituent accounts, each of which links to the General Ledger
 * already filtered to that account and period — completing the chain
 * statement → account → ledger → journal → source.
 */
function Line({
  line,
  range,
  indent,
}: {
  line: StatementLine
  range: { from: string; to: string }
  indent: boolean
}) {
  const [open, setOpen] = useState(false)
  const expandable = line.breakdown.length > 0
  const emphasis = line.kind === "SUBTOTAL"

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-[1fr_140px_140px] items-center gap-4 border-b px-4 py-2 text-sm last:border-0",
          emphasis && "border-t bg-muted/40 font-medium",
          expandable && "cursor-pointer hover:bg-muted/30"
        )}
        onClick={expandable ? () => setOpen((v) => !v) : undefined}
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  setOpen((v) => !v)
                }
              }
            : undefined
        }
      >
        <span className={cn("flex items-center gap-1", indent && !emphasis && "pl-4")}>
          {expandable ? (
            open ? (
              <RiArrowDownSLine className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <RiArrowRightSLine className="size-4 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="size-4 shrink-0" />
          )}
          {line.label}
        </span>
        <span className="text-right tabular-nums">
          {emphasis ? takaTotal(line.current) : taka(line.current)}
        </span>
        <span className="text-right tabular-nums text-muted-foreground">
          {emphasis ? takaTotal(line.comparative) : taka(line.comparative)}
        </span>
      </div>

      {open &&
        line.breakdown.map((row) => (
          <div
            key={row.accountId}
            className="grid grid-cols-[1fr_140px_140px] items-center gap-4 border-b bg-muted/20 px-4 py-1.5 text-sm last:border-0"
          >
            <Link
              href={`./ledger?accountId=${row.accountId}&from=${range.from}&to=${range.to}`}
              className="pl-9 hover:underline"
            >
              <span className="text-muted-foreground tabular-nums">{row.code}</span> {row.name}
            </Link>
            <span className="text-right tabular-nums">{taka(row.current)}</span>
            <span className="text-right tabular-nums text-muted-foreground">
              {taka(row.comparative)}
            </span>
          </div>
        ))}
    </>
  )
}

export function StatementTable({
  currentLabel,
  comparativeLabel,
  groups,
  range,
}: {
  currentLabel: string
  comparativeLabel: string
  /** A heading of null renders the lines with no section header. */
  groups: Array<{
    heading: string | null
    lines: StatementLine[]
    total?: { label: string; current: string; comparative: string }
  }>
  range: { from: string; to: string }
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[1fr_140px_140px] gap-4 border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Particulars</span>
          <span className="text-right">{currentLabel}</span>
          <span className="text-right">{comparativeLabel}</span>
        </div>

        {groups.map((group, i) => (
          <div key={group.heading ?? i}>
            {group.heading && (
              <div className="border-b bg-muted/20 px-4 py-2 text-sm font-semibold">
                {group.heading}
              </div>
            )}
            {group.lines.map((line) => (
              <Line key={line.key} line={line} range={range} indent={Boolean(group.heading)} />
            ))}
            {group.total && (
              <div className="grid grid-cols-[1fr_140px_140px] gap-4 border-b border-t px-4 py-2 text-sm font-medium">
                <span>{group.total.label}</span>
                <span className="text-right tabular-nums">{takaTotal(group.total.current)}</span>
                <span className="text-right tabular-nums text-muted-foreground">
                  {takaTotal(group.total.comparative)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
