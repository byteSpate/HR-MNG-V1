/**
 * Payslip PDF rendering.
 *
 * One lazily-launched browser, reused across every render. Puppeteer costs
 * roughly 0.5–2s per document plus a launch, so a browser per request
 * exhausts memory under any load.
 *
 * **Rendering never happens during `process`.** 500 payslips inside that
 * request is a multi-minute HTTP call any proxy will time out, and a
 * half-rendered run if it dies. `process` computes numbers only; PDFs are
 * rendered on first request and cached.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"

import type { Browser } from "puppeteer"

import { env } from "../../config/env"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import type { PayslipBreakdown, PayslipLine } from "./payroll.types"
import { getPdf, putPdf, storageKey } from "./payroll.storage"

let browserPromise: Promise<Browser> | null = null

/**
 * Never launched at import time, and never in tests — a leaked browser
 * handle hangs vitest exactly as a leaked cron handle does.
 */
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = import("puppeteer").then((puppeteer) =>
      puppeteer.default.launch({
        // Undefined locally, where puppeteer resolves its own download. On a
        // dyno the binary comes from the chrome-for-testing buildpack, which
        // exports only PATH — it does NOT set CHROME_PATH. That config var is
        // set explicitly on the app to point at
        // /app/.chrome-for-testing/chrome-linux64/chrome. Without it,
        // PUPPETEER_SKIP_DOWNLOAD=true leaves nothing for puppeteer to find
        // and every render throws.
        executablePath: process.env.CHROME_PATH,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      })
    )
  }
  return browserPromise
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return
  const browser = await browserPromise.catch(() => null)
  browserPromise = null
  await browser?.close().catch(() => undefined)
}

// Closed on exit, so a shutdown does not leave an orphaned Chromium.
for (const signal of ["SIGINT", "SIGTERM", "beforeExit"] as const) {
  process.once(signal, () => {
    void closeBrowser()
  })
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** Minimal HTML escaping — a beneficiary name is user data in a template. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function lineRows(lines: PayslipLine[], currency: string): string {
  if (lines.length === 0) {
    return `<tr><td colspan="3" class="muted">None</td></tr>`
  }
  return lines
    .map((line) => {
      const basis =
        line.calc === "PERCENT_OF_BASIC"
          ? `${line.value}% of basic`
          : line.calc === "ADJUSTMENT"
            ? "Adjustment"
            : "Fixed"
      return `<tr><td>${escapeHtml(line.label)}</td><td class="muted">${basis}</td><td class="num">${currency} ${line.amount}</td></tr>`
    })
    .join("")
}

function totalRow(label: string, currency: string, amount: string): string {
  return `<tr class="total"><td>${label}</td><td></td><td class="num">${currency} ${amount}</td></tr>`
}

export function renderPayslipHtml(
  template: string,
  payslip: {
    payslipNo: string
    currency: string
    calendarDays: number
    lopDays: { toFixed(n: number): string }
    payableDays: { toFixed(n: number): string }
    grossPay: { toFixed(n: number): string }
    totalDeductions: { toFixed(n: number): string }
    netPay: { toFixed(n: number): string }
    reimbursements: { toFixed(n: number): string }
    netPayable: { toFixed(n: number): string }
    netPayableBdt: { toFixed(n: number): string }
    fxRateToBdt: { toFixed(n: number): string }
    breakdown: unknown
    employee: { fullName: string; employeeCode: string }
    payrollRun: { month: number; year: number }
  }
): string {
  const breakdown = payslip.breakdown as PayslipBreakdown
  const currency = payslip.currency

  // Earning adjustments belong with earnings, deduction adjustments with
  // deductions — the document groups by effect, not by data source.
  const earningAdjustments = (breakdown.adjustments ?? []).filter((a) => a.kind === "EARNING")
  const deductionAdjustments = (breakdown.adjustments ?? []).filter((a) => a.kind === "DEDUCTION")

  const earningsRows =
    lineRows([...(breakdown.earnings ?? []), ...earningAdjustments], currency) +
    totalRow("Gross pay", currency, payslip.grossPay.toFixed(2))
  const deductionsRows =
    lineRows([...(breakdown.deductions ?? []), ...deductionAdjustments], currency) +
    totalRow("Total deductions", currency, payslip.totalDeductions.toFixed(2))

  // Reimbursements get their own section, never folded into earnings —
  // folding them in would misrepresent returned money as wages.
  const claims = breakdown.reimbursements ?? []
  const reimbursementsSection =
    claims.length === 0
      ? ""
      : `<h2>Reimbursements</h2>
         <table>
           <thead><tr><th>Category</th><th>Spent on</th><th class="num">Amount</th></tr></thead>
           <tbody>${claims
             .map(
               (claim) =>
                 `<tr><td>${escapeHtml(claim.category)}</td><td class="muted">${claim.expenseDate}${
                   claim.spentCurrency !== currency
                     ? ` · ${claim.spentCurrency} ${claim.spentAmount} @ ${claim.fxRateToBdt}`
                     : ""
                 }</td><td class="num">${currency} ${claim.amount}</td></tr>`
             )
             .join("")}</tbody>
         </table>`

  // For a non-BDT payslip, show the frozen rate and the BDT equivalent — that
  // is what actually reached the bank.
  const fxSection =
    currency === "BDT"
      ? ""
      : `<div class="fx">Converted at the rate frozen for this payroll month:
           1 ${currency} = ${payslip.fxRateToBdt.toFixed(6)} BDT.
           Net payable <strong>BDT ${payslip.netPayableBdt.toFixed(2)}</strong>,
           which is the figure the bank file pays.</div>`

  const replacements: Record<string, string> = {
    COMPANY_NAME: escapeHtml(env.COMPANY_NAME),
    COMPANY_ADDRESS: escapeHtml(env.COMPANY_ADDRESS),
    PERIOD: `${MONTHS[payslip.payrollRun.month - 1]} ${payslip.payrollRun.year}`,
    EMPLOYEE_NAME: escapeHtml(payslip.employee.fullName),
    EMPLOYEE_CODE: escapeHtml(payslip.employee.employeeCode),
    PAYSLIP_NO: escapeHtml(payslip.payslipNo),
    CURRENCY: currency,
    CALENDAR_DAYS: String(payslip.calendarDays),
    PAYABLE_DAYS: payslip.payableDays.toFixed(2),
    LOP_DAYS: payslip.lopDays.toFixed(2),
    PAID_LEAVE: String(breakdown.attendance?.onPaidLeave ?? 0),
    EARNINGS_ROWS: earningsRows,
    DEDUCTIONS_ROWS: deductionsRows,
    REIMBURSEMENTS_SECTION: reimbursementsSection,
    NET_PAY: payslip.netPay.toFixed(2),
    REIMBURSEMENTS_TOTAL: payslip.reimbursements.toFixed(2),
    NET_PAYABLE: payslip.netPayable.toFixed(2),
    FX_SECTION: fxSection,
    GENERATED_AT: new Date().toISOString().slice(0, 10),
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => replacements[key] ?? "")
}

async function loadTemplate(): Promise<string> {
  // Resolved from the source tree; `src/templates` is copied beside `dist`
  // by the build, so both layouts find it.
  const candidates = [
    path.join(__dirname, "../../templates/payslip.html"),
    path.join(process.cwd(), "src/templates/payslip.html"),
  ]
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8")
    } catch {
      continue
    }
  }
  throw new AppError(500, "Payslip template not found")
}

/**
 * Stores the rendered bytes, off the request path.
 *
 * Every failure is swallowed and logged: the caller has already returned the
 * PDF, so a store that is down makes the next download slower, never broken.
 * Exported for the tests, which need something to await.
 */
export async function cachePdf(
  payslipId: string,
  key: string,
  bytes: Uint8Array
): Promise<void> {
  try {
    const stored = await putPdf(key, bytes)
    if (!stored) return
    await prisma.payslip.update({ where: { id: payslipId }, data: { pdfUrl: key } })
  } catch (err) {
    console.error("[payslip pdf] caching failed", key, err)
  }
}

/**
 * Renders on first request, caches to storage, and serves the cached file
 * thereafter. Re-emailing therefore does not re-render.
 */
export async function getOrRenderPayslipPdf(payslipId: string): Promise<Buffer> {
  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    include: {
      employee: { select: { fullName: true, employeeCode: true } },
      payrollRun: { select: { month: true, year: true } },
    },
  })
  if (!payslip) throw new AppError(404, "Payslip not found")

  const key = storageKey("payslip", payslip.payslipNo)
  const cached = await getPdf(key)
  if (cached) return cached

  const html = renderPayslipHtml(await loadTemplate(), payslip)
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: "load" })
    const bytes = await page.pdf({
      format: "a4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    })
    // Caching happens **after** the response, not before it. The upload costs
    // seconds against Cloudinary, and it is not work the person waiting for
    // their payslip should pay for: a cold render already spends a browser
    // launch plus the render itself, and Heroku's router gives up at 30s.
    //
    // `pdfUrl` is set only when the upload actually succeeded. Writing the key
    // unconditionally records a cache entry that is not there, so every later
    // read misses while the record claims a file exists.
    void cachePdf(payslipId, key, bytes)
    return Buffer.from(bytes)
  } finally {
    await page.close().catch(() => undefined)
  }
}
