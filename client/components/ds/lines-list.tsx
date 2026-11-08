import type { CSSProperties, ReactNode } from "react"

import { cx } from "./classes"
import { gridTemplate, isEmptyCell, type LinesColumn } from "./layout-helpers"

/**
 * A wide grid that turns into small cards on a phone.
 * On md and up it is a header row and one row per line.
 * Below md each row is a card: every value gets its label above it, and empty values are left out.
 * Each cell is rendered once, so inputs inside rows are not duplicated.
 */
export function LinesList({
  columns,
  rows,
  getKey,
  header,
  className,
}: {
  columns: ReadonlyArray<LinesColumn>
  rows: ReadonlyArray<Record<string, ReactNode>>
  getKey: (row: Record<string, ReactNode>, index: number) => string
  /** Set false when the caller draws its own header. */
  header?: boolean
  className?: string
}) {
  const style = { "--lines-cols": gridTemplate(columns) } as CSSProperties
  const grid = "grid grid-cols-2 gap-x-3 gap-y-2 md:[grid-template-columns:var(--lines-cols)] md:gap-x-3"
  return (
    <div className={className} style={style} role="table">
      {header === false ? null : (
        <div role="row" className={cx(grid, "max-md:hidden border-b border-line px-3 pb-2 text-caption font-bold text-ink-muted uppercase")}>
          {columns.map((c) => (
            <div key={c.key} role="columnheader" className={cx(c.align === "right" && "text-right", c.labelClassName)}>
              {c.label}
            </div>
          ))}
        </div>
      )}
      {rows.map((row, i) => (
        <div
          key={getKey(row, i)}
          role="row"
          className={cx(grid, "border-b border-line px-3 py-3 max-md:rounded-md max-md:border max-md:mb-2 md:py-2")}
        >
          {columns.map((c) => (
            <div
              key={c.key}
              role="cell"
              className={cx(
                "min-w-0",
                isEmptyCell(row[c.key]) && "max-md:hidden",
                c.fullOnPhone && "max-md:col-span-2",
                c.align === "right" && "md:text-right",
              )}
            >
              {c.label ? <div className={cx("mb-0.5 text-caption font-bold md:hidden", c.labelClassName ?? "text-ink-muted")}>{c.label}</div> : null}
              {row[c.key]}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
