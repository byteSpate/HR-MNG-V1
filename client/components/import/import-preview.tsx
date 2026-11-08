import { RiCheckLine } from "@remixicon/react"

import type { TableCell } from "@/components/dashboard/types"

/**
 * The parts of an import preview that are the same whatever is being
 * imported.
 *
 * `AssetImportIssue` and `CostImportIssue` are the same three fields under two
 * names, because the server's import kernel (`server/src/utils/import/`) emits
 * one issue shape for every consumer. This is the client side of that: the
 * asset and cost wizards had byte-identical copies of the row-union logic and
 * near-identical issue cells, which had already drifted — one showed a green
 * check for a clean row and the other a grey dash, so the same file reviewed
 * in two places looked like two different verdicts.
 *
 * A third consumer (historical expenses) is on the roadmap, which is what
 * makes this worth naming rather than copying a third time.
 */
export interface ImportIssue {
  rowNumber: number
  column: string | null
  message: string
}

/**
 * Every row number the preview has something to say about, in file order.
 *
 * The union matters: a row can fail so early that it never becomes a parsed
 * row at all, and listing only `rows` would drop exactly the rows that need
 * looking at. Sorted numerically rather than by insertion, so the table reads
 * in the order the file does.
 */
export function previewRowNumbers(
  rows: { rowNumber: number }[],
  issues: ImportIssue[]
): number[] {
  return Array.from(
    new Set<number>([...rows.map((r) => r.rowNumber), ...issues.map((i) => i.rowNumber)])
  ).sort((a, b) => a - b)
}

/**
 * The issues cell for one row.
 *
 * A glyph rather than a dash or a blank for a clean row. Most rows pass, so
 * repeating "No issues" down the column is noise, but an empty cell beside red
 * ones reads as "not checked" rather than "checked and fine".
 */
export function issuesCell(rowIssues: ImportIssue[]): TableCell {
  if (rowIssues.length === 0) {
    return {
      node: <RiCheckLine className="size-4 text-success" aria-label="No issues" role="img" />,
    }
  }
  return {
    node: (
      <ul className="space-y-0.5">
        {rowIssues.map((issue, i) => (
          <li key={i} className="text-caption leading-snug font-semibold text-danger">
            {issue.column ? `${issue.column}: ` : ""}
            {issue.message}
          </li>
        ))}
      </ul>
    ),
  }
}

/**
 * What to say when a file parsed without producing a single row.
 *
 * Neither wizard had this state: an empty file rendered a header row with
 * nothing under it and a live Commit button, which imports nothing and reports
 * success. Stating it is the difference between "your file is empty" and "this
 * screen is broken".
 */
export function ImportPreviewEmpty({ noun }: { noun: string }) {
  return (
    <div className="rounded-md border border-line bg-white px-5.5 py-8 text-center">
      <div className="text-body-sm font-bold">No rows to import</div>
      <p className="mx-auto mt-1 max-w-[46ch] text-caption leading-relaxed text-ink-muted">
        The file was read successfully but held no {noun}. Check that the data starts under the
        header row and that the sheet is not empty.
      </p>
    </div>
  )
}
