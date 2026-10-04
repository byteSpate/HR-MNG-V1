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

  const logo = ctx.logo
    ? `<img class="logo" src="${ctx.logo}" alt="${escapeHtml(ctx.company)}" />`
    : `<span class="wordmark">${escapeHtml(ctx.company)}</span>`
  const sub = [spec.subtitle, spec.filterNote].filter(Boolean).map((s) => escapeHtml(s as string)).join(" · ")
  const count = `${spec.rows.length} ${spec.rows.length === 1 ? "row" : "rows"}`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #16233F; font-size: 9pt; margin: 0; }
  .stripe { height: 6px; background: linear-gradient(90deg, #E23B2E 33.3%, #3B63B8 33.3% 66.6%, #3FAE5A 66.6%); }
  .brandbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #FFFFFF; }
  .logo { height: 35px; width: auto; display: block; }
  .wordmark { font-size: 14pt; font-weight: 700; color: #1B3A82; }
  .pill { background: #E1E9FB; color: #1B3A82; border-radius: 999px; padding: 4px 12px; font-size: 8.5pt; font-weight: 700; white-space: nowrap; }
  .panel { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; padding: 16px 14px 18px; background: #1B3A82; background-image: linear-gradient(135deg, #1B3A82 0%, #142C66 100%); color: #FFFFFF; }
  h1 { font-size: 17pt; font-weight: 700; line-height: 1.25; letter-spacing: -0.01em; margin: 0; }
  .panel-sub { color: #C9D6F5; margin: 4px 0 0; font-size: 9.5pt; }
  .mint { width: 40px; height: 3px; border-radius: 2px; background: #7AE3C8; margin-top: 12px; }
  .meta { color: #C9D6F5; margin: 0; text-align: right; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
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
<div class="brandbar">${logo}<span class="pill">${count}</span></div>
<div class="panel">
  <div><h1>${escapeHtml(spec.title)}</h1>${sub ? `<p class="panel-sub">${sub}</p>` : ""}<div class="mint"></div></div>
  <p class="meta">${escapeHtml(stamp(ctx.generatedAt, ctx.timeZone))}</p>
</div>
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
