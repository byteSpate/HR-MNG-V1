import type { TableCell } from "@/components/dashboard/types"

/**
 * A table cell built from its own markup (`node`) reads at 13px, the size the
 * Leave table's plain text cells use. Without this it inherits the page's 16px
 * and sits larger than the header above it. Cells that are plain text or a tag
 * are already sized by the table and pass through unchanged.
 */
export function sized(cell: TableCell): TableCell {
  return cell.node ? { ...cell, node: <div className="min-w-0 text-[13px]">{cell.node}</div> } : cell
}
