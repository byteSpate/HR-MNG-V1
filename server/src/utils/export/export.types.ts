export type ExportFormat = "xlsx" | "csv" | "pdf"
export type ExportCellType = "text" | "integer" | "decimal" | "date" | "boolean"
export type ExportValue = string | number | boolean | Date | null

export interface ExportColumn {
  /** Heading in Excel and CSV. Matches the import example where the column exists there. */
  header: string
  /** A friendlier heading for the PDF. Falls back to `header`. */
  pdfHeader?: string
  type: ExportCellType
  /** Digits after the point for `decimal`. Default 2. */
  decimals?: number
  /** One of the main columns that the PDF shows. When none is flagged, the PDF shows all. */
  inPdf?: boolean
}

export interface ExportSpec {
  title: string
  subtitle?: string
  /** Says which filter produced the rows, for example "Year 2026". */
  filterNote?: string
  columns: ExportColumn[]
  /** One array per row, in the same order as `columns`. */
  rows: ExportValue[][]
}
