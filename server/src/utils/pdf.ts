/**
 * Turning HTML into a PDF, in one place.
 *
 * `payroll.pdf.ts` and `statements.pdf.ts` each grew their own copy of this —
 * a lazily-launched browser, the same Heroku `executablePath` workaround, the
 * same three shutdown signals. A third copy went in with the attendance
 * reports, so it was lifted here instead.
 *
 * One browser, shared. Puppeteer costs roughly 0.5-2s per document plus a
 * launch, and a browser per request exhausts a 512MB dyno.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import type { Browser, PDFOptions } from "puppeteer"

let browserPromise: Promise<Browser> | null = null

/**
 * Never launched at import time, and never in tests — puppeteer is imported
 * inside the function on purpose. A browser handle left open hangs vitest
 * exactly as a leaked cron handle does, which is why every renderer in this
 * codebase keeps its HTML building in a separate, pure function.
 */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import("puppeteer").then((puppeteer) =>
      puppeteer.default.launch({
        // The chrome-for-testing buildpack exports only PATH, and
        // PUPPETEER_SKIP_DOWNLOAD=true leaves no bundled Chromium to fall
        // back to, so without this every render throws on Heroku.
        executablePath: process.env.CHROME_PATH,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      })
    )
  }
  return browserPromise
}

export async function closePdfBrowser(): Promise<void> {
  if (!browserPromise) return
  const browser = await browserPromise.catch(() => null)
  browserPromise = null
  await browser?.close().catch(() => undefined)
}

// Closed on exit, so a shutdown does not leave an orphaned Chromium.
for (const signal of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
  process.once(signal, () => {
    void closePdfBrowser()
  })
}

/**
 * Renders a complete HTML document to PDF bytes.
 *
 * `waitUntil: "load"` rather than `networkidle0`: these documents are
 * self-contained strings with no network to go idle, and `networkidle0` waits
 * out its own timeout for nothing.
 */
export async function renderPdf(html: string, options: PDFOptions = {}): Promise<Buffer> {
  const page = await (await getBrowser()).newPage()
  try {
    await page.setContent(html, { waitUntil: "load" })
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12mm", bottom: "14mm", left: "10mm", right: "10mm" },
        ...options,
      })
    )
  } finally {
    await page.close().catch(() => undefined)
  }
}

/**
 * The logo and the seal, as `data:` URIs.
 *
 * Embedded rather than linked. `page.setContent` gives the document no base
 * URL, so a relative `<img src>` resolves against `about:blank` and renders as
 * a broken image; an absolute URL would make every render depend on the
 * client's host being up. Base64 costs about 15KB of markup for the logo and
 * 40KB for the seal, once per document, which is nothing against a PDF.
 *
 * Cached after the first read, because a report is a stream of pages and the
 * files never change between them.
 */
const assetCache = new Map<string, string | null>()

export async function brandAsset(name: "logo" | "seal"): Promise<string | null> {
  const cached = assetCache.get(name)
  if (cached !== undefined) return cached

  // `src/templates` is copied beside `dist` by the build, so both layouts find
  // it — the same two candidates `payroll.pdf.ts` resolves its template from.
  const candidates = [
    path.join(__dirname, `../templates/brand/${name}.png`),
    path.join(process.cwd(), `src/templates/brand/${name}.png`),
  ]
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(candidate)
      const uri = `data:image/png;base64,${bytes.toString("base64")}`
      assetCache.set(name, uri)
      return uri
    } catch {
      continue
    }
  }

  // Missing artwork is not a reason to refuse a report. The document drops the
  // image and prints; a thrown error would mean nobody can export anything
  // because a file did not get copied.
  console.warn(`[pdf] brand asset not found: ${name}.png`)
  assetCache.set(name, null)
  return null
}

/**
 * Employee names, designations and correction notes are user data landing in
 * a template. An unescaped `<script>` in a note body executes in the
 * rendering browser.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
