import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { renderPayslipHtml } from "./payroll.pdf"
import { storageKey } from "./payroll.storage"
import { dec } from "./payroll.money"

// Note what this file does NOT do: launch a browser. Puppeteer is imported
// lazily inside getBrowser(), so nothing here starts Chromium — a leaked
// browser handle hangs vitest exactly as a leaked cron handle does. The
// template rendering is the part worth asserting anyway; a PDF is the one
// output a test cannot really check.

const TEMPLATE = `
  <h1>{{COMPANY_NAME}}</h1><span>{{COMPANY_ADDRESS}}</span>
  <p>{{PERIOD}} {{EMPLOYEE_NAME}} {{EMPLOYEE_CODE}} {{PAYSLIP_NO}} {{CURRENCY}}</p>
  <p>{{CALENDAR_DAYS}} {{PAYABLE_DAYS}} {{LOP_DAYS}} {{PAID_LEAVE}}</p>
  <table>{{EARNINGS_ROWS}}</table>
  <table>{{DEDUCTIONS_ROWS}}</table>
  {{REIMBURSEMENTS_SECTION}}
  <p>{{NET_PAY}} {{REIMBURSEMENTS_TOTAL}} {{NET_PAYABLE}}</p>
  {{FX_SECTION}}
  <footer>{{GENERATED_AT}}</footer>
`

function payslip(over: Record<string, unknown> = {}) {
  return {
    payslipNo: "BS-PAY-000001",
    currency: "BDT",
    calendarDays: 31,
    lopDays: dec("3.00"),
    payableDays: dec("28.00"),
    grossPay: dec("72258.06"),
    totalDeductions: dec("7500.00"),
    netPay: dec("64758.06"),
    reimbursements: dec("1200.00"),
    netPayable: dec("65958.06"),
    netPayableBdt: dec("65958.06"),
    fxRateToBdt: dec(1),
    employee: { fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001" },
    payrollRun: { month: 7, year: 2026 },
    breakdown: {
      currency: "BDT",
      fxRateToBdt: "1.000000",
      earnings: [
        { code: "BASIC", label: "Basic", calc: "FIXED", value: "50000.00", amount: "50000.00" },
        { code: "HOUSE_RENT", label: "House rent", calc: "PERCENT_OF_BASIC", value: "50.00", amount: "25000.00" },
      ],
      deductions: [
        { code: "PF", label: "Provident fund", calc: "PERCENT_OF_BASIC", value: "10.00", amount: "5000.00" },
      ],
      adjustments: [],
      reimbursements: [
        {
          claimId: "claim-1",
          category: "Travel",
          expenseDate: "2026-07-03",
          spentCurrency: "BDT",
          spentAmount: "1200.00",
          fxRateToBdt: "1.000000",
          amount: "1200.00",
        },
      ],
      attendance: {
        calendarDays: 31, workingDays: 27, present: 23, absent: 1,
        onPaidLeave: 2, onUnpaidLeave: 2, lopDays: 3, payableDays: 28,
      },
    },
    ...over,
  }
}

describe("renderPayslipHtml", () => {
  it("opens with the brand header: stripe, logo, and a navy panel titled Payslip with the period", () => {
    const html = renderPayslipHtml(
      "<style>{{BRAND_CSS}}</style>{{BRAND_HEADER}}",
      payslip() as never,
      "data:image/png;base64,LOGO"
    )
    expect(html).toContain('<div class="bd-stripe"></div>')
    expect(html).toContain('src="data:image/png;base64,LOGO"')
    expect(html).toContain('<h1 class="bd-title">Payslip</h1>')
    expect(html).toMatch(/<p class="bd-sub">[A-Z][a-z]+ \d{4}<\/p>/)
    expect(html).toContain(".bd-panel")
    expect(html).not.toMatch(/\{\{\w+\}\}/)
  })

  it("the real payslip template has a place for the brand header and its style", () => {
    const file = readFileSync(path.join(__dirname, "../../templates/payslip.html"), "utf8")
    expect(file).toContain("{{BRAND_CSS}}")
    expect(file).toContain("{{BRAND_HEADER}}")
  })

  it("the real payslip template is black and white: black heading rows, black text", () => {
    const file = readFileSync(path.join(__dirname, "../../templates/payslip.html"), "utf8")
    expect(file).toMatch(/th \{[^}]*background: #17191C; color: #FFFFFF/)
    expect(file).toMatch(/\.label \{[^}]*color: #17191C/)
    expect(file).toMatch(/footer \{[^}]*color: #17191C/)
    for (const grey of ["#71717a", "#a1a1aa"]) expect(file).not.toContain(grey)
  })

  it("substitutes every placeholder — none are left unreplaced", () => {
    const html = renderPayslipHtml(TEMPLATE, payslip() as never)
    expect(html).not.toMatch(/\{\{\w+\}\}/)
  })

  it("shows the employee, payslip number and period", () => {
    const html = renderPayslipHtml(TEMPLATE, payslip() as never)
    expect(html).toContain("Ayesha Rahman")
    expect(html).toContain("BS-PAY-000001")
    expect(html).toContain("July 2026")
  })

  it("renders reimbursements as their own section, not inside earnings", () => {
    // Folding a reimbursement into earnings would misrepresent returned
    // money as wages.
    const html = renderPayslipHtml(TEMPLATE, payslip() as never)
    expect(html).toContain("Reimbursements")
    const earningsBlock = html.slice(0, html.indexOf("Reimbursements"))
    expect(earningsBlock).not.toContain("Travel")
  })

  it("omits the reimbursements section entirely when there are none", () => {
    const bare = payslip()
    ;(bare.breakdown as { reimbursements: unknown[] }).reimbursements = []
    const html = renderPayslipHtml(TEMPLATE, bare as never)
    expect(html).not.toContain("Reimbursements")
  })

  it("groups an earning adjustment with earnings and a deduction one with deductions", () => {
    const withAdjustments = payslip()
    ;(withAdjustments.breakdown as { adjustments: unknown[] }).adjustments = [
      { code: "FESTIVAL_BONUS", label: "Eid bonus", calc: "ADJUSTMENT", value: "5000.00", amount: "5000.00", kind: "EARNING" },
      { code: "ADVANCE", label: "Advance recovery", calc: "ADJUSTMENT", value: "500.00", amount: "500.00", kind: "DEDUCTION" },
    ]
    const html = renderPayslipHtml(TEMPLATE, withAdjustments as never)
    const tables = html.split("<table>")
    expect(tables[1]).toContain("Eid bonus")
    expect(tables[1]).not.toContain("Advance recovery")
    expect(tables[2]).toContain("Advance recovery")
  })

  it("shows no FX block for a BDT payslip", () => {
    const html = renderPayslipHtml(TEMPLATE, payslip() as never)
    expect(html).not.toContain("Converted at the rate")
  })

  it("shows the frozen rate and BDT equivalent for a USD payslip", () => {
    // That is what actually reached the bank, so it belongs on the document.
    const usd = payslip({
      currency: "USD",
      netPayable: dec("2935.10"),
      netPayableBdt: dec("359549.75"),
      fxRateToBdt: dec("122.5"),
    })
    const html = renderPayslipHtml(TEMPLATE, usd as never)
    expect(html).toContain("1 USD = 122.500000 BDT")
    expect(html).toContain("359549.75")
  })

  it("escapes HTML in a beneficiary name rather than injecting it", () => {
    const html = renderPayslipHtml(
      TEMPLATE,
      payslip({ employee: { fullName: "<script>alert(1)</script>", employeeCode: "BS-EMP-001" } }) as never
    )
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("labels a percentage line with its configured basis", () => {
    const html = renderPayslipHtml(TEMPLATE, payslip() as never)
    expect(html).toContain("50.00% of basic")
  })
})

describe("storageKey", () => {
  it("is stable for the same document number", () => {
    expect(storageKey("payslip", "BS-PAY-000001")).toBe(storageKey("payslip", "BS-PAY-000001"))
  })

  it("differs per document and per kind", () => {
    expect(storageKey("payslip", "BS-PAY-000001")).not.toBe(storageKey("payslip", "BS-PAY-000002"))
    expect(storageKey("payslip", "X")).not.toBe(storageKey("settlement", "X"))
  })

  it("contains no path separators, so a key cannot traverse out of the directory", () => {
    const key = storageKey("payslip", "../../etc/passwd")
    expect(key).not.toContain("/")
    expect(key).not.toContain("..")
    expect(key).toMatch(/^payslip-[0-9a-f]{16}\.pdf$/)
  })
})
