/**
 * The header look of the report PDFs, the same one the emails use: a thin red,
 * blue and green stripe, the logo on white, then a navy panel with the title
 * and a short mint bar. Colours come from `templates/email.ts`.
 *
 * Shared by the attendance and expense reports. Both keep the same header
 * markup (`<header>` with the logo block first and `.meta` second), so only
 * the style changes, plus the stripe above it.
 */

export const BRAND_STRIPE_HTML = '<div class="stripe"></div>'

export const BRAND_HEADER_CSS = `
  .stripe { height: 6px; background: linear-gradient(90deg, #E23B2E 33.3%, #3B63B8 33.3% 66.6%, #3FAE5A 66.6%); }
  header { display: block; margin-bottom: 14px; }
  header > div:first-child { background: #FFFFFF; padding: 10px 14px; }
  .logo { height: 38px; width: auto; display: block; }
  .company { font-size: 13pt; font-weight: 700; letter-spacing: 0.01em; color: #1B3A82; }
  .tagline { margin-top: 5px; font-size: 9pt; font-weight: 600; color: #4F5B73; letter-spacing: 0.01em; }
  .meta { text-align: left; padding: 14px 14px 16px; background: #1B3A82; background-image: linear-gradient(135deg, #1B3A82 0%, #142C66 100%); }
  .meta::after { content: ""; display: block; width: 40px; height: 3px; border-radius: 2px; background: #7AE3C8; margin-top: 10px; }
  .metatitle { margin-bottom: 4px; font-size: 11.5pt; font-weight: 700; color: #FFFFFF; }
  .v { font-size: 8.5pt; font-weight: 600; color: #C9D6F5; }
  .v + .v { margin-top: 2px; }
  .vmuted { font-weight: 500; }
`

/**
 * The same look for documents that are not the two reports: the payslip, the
 * financial statements, the customer statement and the meeting minutes.
 *
 * Every class starts with `bd-`, so none of these rules can touch a document's
 * own `h1`, `.meta` or `.logo`. The title is an `h1` with a class, so it stays
 * the heading of the page.
 */

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export interface BrandDocHeader {
  /** A data URI, or null when the logo file is missing. */
  logo: string | null
  company: string
  title: string
  /** Short lines under the title, such as the period or the company address. */
  lines?: string[]
  /** Small text at the right of the panel, such as the date it was made. */
  stamp?: string
}

export function brandDocHeaderHtml({ logo, company, title, lines = [], stamp }: BrandDocHeader): string {
  const mark = logo
    ? `<img class="bd-logo" src="${logo}" alt="${esc(company)}" />`
    : `<span class="bd-word">${esc(company)}</span>`
  const subs = lines.map((line) => `<p class="bd-sub">${esc(line)}</p>`).join("")
  return `<div class="bd-stripe"></div>
<div class="bd-bar">${mark}</div>
<div class="bd-panel"><div><h1 class="bd-title">${esc(title)}</h1>${subs}<div class="bd-mint"></div></div>${stamp ? `<p class="bd-stamp">${esc(stamp)}</p>` : ""}</div>`
}

export const BRAND_DOC_CSS = `
  .bd-stripe { height: 6px; background: linear-gradient(90deg, #E23B2E 33.3%, #3B63B8 33.3% 66.6%, #3FAE5A 66.6%); }
  .bd-bar { padding: 10px 14px; background: #FFFFFF; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .bd-logo { height: 35px; width: auto; display: block; }
  .bd-word { font-size: 14pt; font-weight: 700; color: #1B3A82; }
  .bd-panel { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 14px; padding: 16px 14px 18px; background: #1B3A82; background-image: linear-gradient(135deg, #1B3A82 0%, #142C66 100%); color: #FFFFFF; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: left; }
  .bd-title { margin: 0; font-size: 14pt; font-weight: 700; line-height: 1.25; letter-spacing: -0.01em; color: #FFFFFF; text-align: left; }
  .bd-sub { margin: 4px 0 0; font-size: 9pt; font-weight: 400; color: #C9D6F5; text-align: left; }
  .bd-mint { width: 40px; height: 3px; margin-top: 12px; border-radius: 2px; background: #7AE3C8; }
  .bd-stamp { margin: 0; font-size: 9pt; color: #C9D6F5; text-align: right; white-space: nowrap; }
`
