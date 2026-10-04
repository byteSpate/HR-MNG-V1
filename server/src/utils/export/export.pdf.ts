/**
 * The export as a printable table.
 *
 * `renderExportHtml` is pure so the document can be asserted without starting
 * Chrome, like `attendance.report.pdf.ts`. `toPdf` is the thin wrapper that
 * loads the logo and drives the browser.
 *
 * A printed page carries the main columns only (`inPdf`). Excel and CSV carry
 * every column, and the footer says so when some were left out.
 */

import { env } from "../../config/env"
import { brandAsset, escapeHtml, renderPdf } from "../pdf"
import { formatCell } from "./export.format"
import type { ExportColumn, ExportSpec } from "./export.types"

export interface PdfContext {
  generatedAt: Date
  timeZone: string
  company: string
  logo: string | null
}

export function pdfColumns(spec: ExportSpec): { columns: ExportColumn[]; omitted: boolean } {
  const flagged = spec.columns.filter((column) => column.inPdf)
  const columns = flagged.length > 0 ? flagged : spec.columns
  return { columns, omitted: columns.length < spec.columns.length }
}

function stamp(at: Date, timeZone: string): string {
  return at.toLocaleString("en-GB", {
    timeZone,
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export function renderExportHtml(spec: ExportSpec, ctx: PdfContext): string {
  const { columns } = pdfColumns(spec)
  const indexes = columns.map((column) => spec.columns.indexOf(column))
  const numeric = (column: ExportColumn) => column.type === "integer" || column.type === "decimal"

  const head = columns
    .map((column) => {
      const label = escapeHtml(column.pdfHeader ?? column.header)
      return numeric(column) ? `<th class="num">${label}</th>` : `<th>${label}</th>`
    })
    .join("")

  const body =
    spec.rows.length === 0
      ? `<tr><td class="empty" colspan="${columns.length}">There are no rows to show.</td></tr>`
      : spec.rows
          .map(
            (row) =>
              `<tr>${columns
                .map((column, i) => {
                  const text = escapeHtml(formatCell(column, row[indexes[i]] ?? null))
                  return numeric(column) ? `<td class="num">${text}</td>` : `<td>${text}</td>`
                })
                .join("")}</tr>`
          )
          .join("")

  const logo = ctx.logo ? `<img src="${ctx.logo}" alt="${escapeHtml(ctx.company)}" />` : escapeHtml(ctx.company)
  const sub = [spec.subtitle, spec.filterNote].filter(Boolean).map((s) => escapeHtml(s as string)).join(" · ")

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #16233F; font-size: 9pt; margin: 0; }
  .stripe { height: 4px; background: linear-gradient(90deg, #E23B2E 33.3%, #3B63B8 33.3% 66.6%, #3FAE5A 66.6%); }
  header { display: flex; justify-content: space-between; align-items: center; padding: 10px 0 6px; }
  header img { height: 30px; }
  h1 { font-size: 15pt; margin: 0; }
  .sub, .meta { color: #4F5B73; margin: 2px 0 0; }
  .meta { text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead { display: table-header-group; }
  th { background: #1B3A82; color: #fff; text-align: left; padding: 5px 6px; font-size: 8.5pt; }
  td { padding: 4px 6px; border-bottom: 1px solid #E3E7EF; vertical-align: top; }
  tr { page-break-inside: avoid; }
  tr:nth-child(even) td { background: #F4F6FB; }
  th.num { text-align: right; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { padding: 16px 6px; color: #4F5B73; }
</style></head>
<body>
<div class="stripe"></div>
<header>
  <div><h1>${escapeHtml(spec.title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ""}</div>
  <div><div>${logo}</div><p class="meta">${escapeHtml(stamp(ctx.generatedAt, ctx.timeZone))}</p></div>
</header>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`
}

export function exportFooterHtml(omitted: boolean): string {
  const note = omitted ? "Open the Excel file to see every column." : ""
  return `<div style="width:100%;padding:0 10mm;font-size:8px;color:#4F5B73;font-family:Arial,sans-serif;display:flex;justify-content:space-between;"><span>${escapeHtml(note)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
}

export async function toPdf(spec: ExportSpec): Promise<Buffer> {
  const logo = await brandAsset("logo")
  const html = renderExportHtml(spec, {
    generatedAt: new Date(),
    timeZone: env.APP_TIMEZONE,
    company: env.COMPANY_NAME,
    logo,
  })
  return renderPdf(html, {
    landscape: true,
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: exportFooterHtml(pdfColumns(spec).omitted),
    margin: { top: "12mm", bottom: "16mm", left: "10mm", right: "10mm" },
  })
}
