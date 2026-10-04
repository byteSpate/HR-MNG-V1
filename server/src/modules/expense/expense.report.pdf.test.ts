import { describe, expect, it } from "vitest"

import type { ExpenseReport, ExpenseReportRow } from "./expense.report"
import { renderExpenseReportHtml } from "./expense.report.pdf"

const AYESHA = { id: "emp-1", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-001" }

function row(over: Partial<ExpenseReportRow> = {}): ExpenseReportRow {
  return {
    id: "claim-1",
    employee: AYESHA,
    name: "Taxi to Motijheel",
    category: { code: "TRAVEL", name: "Travel and conveyance" },
    expenseDate: "2026-07-03",
    amount: "1200.00",
    currency: "BDT",
    status: "REIMBURSED",
    description: "Client visit",
    travelFrom: "Gulshan 1",
    travelTo: "Motijheel",
    receipts: 2,
    paidOn: "BS-PAY-000007",
    submittedOn: "2026-07-05",
    fxRateToBdt: null,
    amountBdt: null,
    reviewedOn: "2026-07-08",
    reviewNote: "Approved. Keep the receipt.",
    ...over,
  }
}

function report(rows: ExpenseReportRow[], employee: ExpenseReport["employee"] = AYESHA): ExpenseReport {
  return {
    from: "2026-07-01",
    to: "2026-07-31",
    employee,
    status: null,
    rows,
    totals: { claims: rows.length, byCurrency: [], byStatus: [] },
  }
}

const html = (r: ExpenseReport) => renderExpenseReportHtml(r, new Date("2026-08-01T04:00:00Z"), "Byte Spate")

describe("the expense report document", () => {
  it("prints every field of a claim", () => {
    const out = html(report([row()]))
    for (const text of [
      "2026-07-03", // spent
      "Sent 2026-07-05", // sent
      "Taxi to Motijheel",
      "Travel and conveyance",
      "Client visit",
      "Gulshan 1 → Motijheel",
      "1200.00 BDT",
      "Reimbursed",
      "on 2026-07-08", // reviewed
      "Approved. Keep the receipt.",
      "BS-PAY-000007",
    ]) {
      expect(out).toContain(text)
    }
  })

  it("opens with the red, blue and green stripe, above the header", () => {
    const out = html(report([row()]))
    expect(out).toContain('<div class="stripe"></div>')
    expect(out.indexOf('class="stripe"')).toBeLessThan(out.indexOf("<header>"))
    expect(out).toContain("#1B3A82")
  })

  it("sets the table text at 7.5pt, the sub line at 6.5pt and the tile numbers at 10.5pt", () => {
    const out = html(report([row()]))
    expect(out).toMatch(/body \{[^}]*font-size: 7\.5pt/)
    expect(out).toMatch(/\.ds \{ font-size: 6\.5pt/)
    expect(out).toMatch(/\.figv \{[^}]*font-size: 10\.5pt/)
  })

  it("shows the BDT value and the frozen rate for an approved USD claim", () => {
    const out = html(report([row({ currency: "USD", amount: "80.00", fxRateToBdt: "122.500000", amountBdt: "9800.00" })]))
    expect(out).toContain("80.00 USD")
    expect(out).toContain("9800.00 BDT at 122.500000")
  })

  it("says a USD claim has no BDT value until it is approved", () => {
    const out = html(report([row({ currency: "USD", amount: "80.00", status: "PENDING", reviewedOn: null, reviewNote: null, paidOn: null })]))
    expect(out).toContain("BDT value is set when approved")
  })

  it("leaves the note and payslip cells empty when there are none", () => {
    const out = html(report([row({ reviewNote: null, paidOn: null, reviewedOn: null, status: "PENDING" })]))
    expect(out).not.toContain("Approved. Keep the receipt.")
    expect(out).not.toContain("BS-PAY")
  })

  it("names the employee on each row only for a report across everybody", () => {
    expect(html(report([row()]))).not.toContain(">Employee<")
    expect(html(report([row()], null))).toContain(">Employee<")
  })

  it("escapes what people typed", () => {
    const out = html(report([row({ reviewNote: "<script>alert(1)</script>" })]))
    expect(out).not.toContain("<script>alert(1)</script>")
    expect(out).toContain("&lt;script&gt;")
  })
})
