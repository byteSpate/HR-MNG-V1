import { describe, expect, it } from "vitest"

import { computePayslip } from "./payroll.calc"
import { dec, type Money, sum } from "./payroll.money"
import type { AdjustmentInput, ComponentInput, PayslipInput, PayslipLine } from "./payroll.types"

/** The seed's BDT structure: the case the spec's worked example is built on. */
const BDT_COMPONENTS: ComponentInput[] = [
  { code: "HOUSE_RENT", label: "House rent", kind: "EARNING", calc: "PERCENT_OF_BASIC", value: dec(50), sortOrder: 1 },
  { code: "MEDICAL", label: "Medical", kind: "EARNING", calc: "FIXED", value: dec(3000), sortOrder: 2 },
  { code: "CONVEYANCE", label: "Conveyance", kind: "EARNING", calc: "FIXED", value: dec(2000), sortOrder: 3 },
  { code: "PF", label: "Provident fund", kind: "DEDUCTION", calc: "PERCENT_OF_BASIC", value: dec(10), sortOrder: 1 },
  { code: "TAX", label: "Income tax", kind: "DEDUCTION", calc: "FIXED", value: dec(2500), sortOrder: 2 },
]

function input(over: Partial<PayslipInput> = {}): PayslipInput {
  return {
    basic: dec(50000),
    components: BDT_COMPONENTS,
    adjustments: [],
    reimbursements: [],
    calendarDays: 31,
    workingDays: 26,
    present: 26,
    absent: 0,
    onPaidLeave: 0,
    onUnpaidLeave: 0,
    ...over,
  }
}

const claim = (amount: string) => ({
  claimId: "claim-1",
  category: "Travel",
  expenseDate: "2026-07-03",
  spentCurrency: "BDT" as const,
  spentAmount: dec(amount),
  fxRateToBdt: dec(1),
  amount: dec(amount),
})

const total = (lines: PayslipLine[]): Money => sum(lines.map((line) => dec(line.amount)))

const adjustmentsOf = (lines: PayslipLine[], kind: "EARNING" | "DEDUCTION") =>
  lines.filter((line) => line.kind === kind)

describe("the spec's BDT worked example, number for number", () => {
  // Basic 50,000; house rent 50%, medical 3,000, conveyance 2,000; PF 10%,
  // tax 2,500. July (31 days), 1 absence + 2 days unpaid leave, one 1,200
  // claim. If any of these drift, the spec and the code disagree and one of
  // them is wrong.
  const result = computePayslip(
    input({ absent: 1, onUnpaidLeave: 2, present: 23, reimbursements: [claim("1200.00")] })
  )

  it("resolves grossFull to 80,000.00", () => {
    expect(result.grossFull.toFixed(2)).toBe("80000.00")
  })

  it("counts 3 lop days and 28 payable of 31", () => {
    expect(result.lopDays.toFixed(2)).toBe("3.00")
    expect(result.payableDays.toFixed(2)).toBe("28.00")
  })

  it("pro-rates gross to 72,258.06", () => {
    expect(result.grossPay.toFixed(2)).toBe("72258.06")
  })

  it("deducts 7,500.00 — PF on full basic plus fixed tax", () => {
    expect(result.totalDeductions.toFixed(2)).toBe("7500.00")
  })

  it("nets 64,758.06", () => {
    expect(result.netPay.toFixed(2)).toBe("64758.06")
  })

  it("pays 65,958.06 after the reimbursement", () => {
    expect(result.reimbursements.toFixed(2)).toBe("1200.00")
    expect(result.netPayable.toFixed(2)).toBe("65958.06")
  })
})

describe("the invariants", () => {
  const cases: Array<[string, PayslipInput]> = [
    ["a clean full month", input()],
    ["a month with loss of pay", input({ absent: 1, onUnpaidLeave: 2, present: 23 })],
    [
      "a month with adjustments both ways",
      input({
        absent: 2,
        present: 24,
        adjustments: [
          { code: "FESTIVAL_BONUS", label: "Eid bonus", kind: "EARNING", amount: dec(50000) },
          { code: "ADVANCE_RECOVERY", label: "Advance recovery", kind: "DEDUCTION", amount: dec("1500.50") },
        ],
      }),
    ],
    ["a month with reimbursements", input({ reimbursements: [claim("1200.00"), claim("340.55")] })],
    ["February", input({ calendarDays: 28, onUnpaidLeave: 1, present: 23 })],
  ]

  for (const [name, payload] of cases) {
    describe(name, () => {
      const result = computePayslip(payload)

      it("payableDays + lopDays === calendarDays", () => {
        expect(result.payableDays.plus(result.lopDays).toFixed(2)).toBe(dec(payload.calendarDays).toFixed(2))
      })

      it("netPay === grossPay − totalDeductions", () => {
        expect(result.netPay.equals(result.grossPay.minus(result.totalDeductions))).toBe(true)
      })

      it("netPayable === netPay + reimbursements", () => {
        expect(result.netPayable.equals(result.netPay.plus(result.reimbursements))).toBe(true)
      })

      // The spec lists this as "Σ breakdown.earnings === grossPay". Earning
      // adjustments live in their own `adjustments` array — the client renders
      // them as a separate section — so the sum that has to reconcile is the
      // whole earnings side, counting each line exactly once. The point of the
      // invariant is that no figure on the document is orphaned.
      it("every earnings-side line sums to grossPay", () => {
        const lines = total(result.breakdown.earnings).plus(
          total(adjustmentsOf(result.breakdown.adjustments, "EARNING"))
        )
        expect(lines.equals(result.grossPay)).toBe(true)
      })

      it("every deductions-side line sums to totalDeductions", () => {
        const lines = total(result.breakdown.deductions).plus(
          total(adjustmentsOf(result.breakdown.adjustments, "DEDUCTION"))
        )
        expect(lines.equals(result.totalDeductions)).toBe(true)
      })

      it("the reimbursement lines sum to the reimbursements total", () => {
        const lines = sum(result.breakdown.reimbursements.map((r) => dec(r.amount)))
        expect(lines.equals(result.reimbursements)).toBe(true)
      })
    })
  }

  it("grossPay === grossFull + earningAdjustments exactly when lopDays is 0", () => {
    // No drift at all in the common case. A pro-ration line must not appear
    // and silently shave a paisa off a full month.
    const result = computePayslip(
      input({ adjustments: [{ code: "ARREARS", label: "Arrears", kind: "EARNING", amount: dec("1234.56") }] })
    )
    expect(result.lopDays.isZero()).toBe(true)
    expect(result.grossPay.equals(result.grossFull.plus(dec("1234.56")))).toBe(true)
    expect(result.breakdown.earnings.some((l) => l.code === "LOP_ADJUSTMENT")).toBe(false)
  })
})

describe("deductions are not pro-rated", () => {
  it("charges percentage deductions on full basic even at 3 lop days", () => {
    // A provident fund contribution is defined on the salary. Pro-rating it
    // would mean somebody who took unpaid leave quietly contributes less to
    // their own retirement.
    const full = computePayslip(input())
    const withLop = computePayslip(input({ absent: 1, onUnpaidLeave: 2, present: 23 }))
    expect(withLop.totalDeductions.equals(full.totalDeductions)).toBe(true)
    expect(withLop.totalDeductions.toFixed(2)).toBe("7500.00")
  })
})

describe("earning adjustments survive pro-ration untouched", () => {
  it("does not reduce a festival bonus for an absence", () => {
    // A bonus is for the festival, not for attendance, so an illness in March
    // must not shrink the Eid bonus.
    const bonus: AdjustmentInput = {
      code: "FESTIVAL_BONUS",
      label: "Eid bonus",
      kind: "EARNING",
      amount: dec(50000),
    }
    const lossy = computePayslip(input({ absent: 5, present: 21, adjustments: [bonus] }))
    const lossyWithoutBonus = computePayslip(input({ absent: 5, present: 21 }))

    // Adding the bonus adds exactly the bonus, whatever the attendance was.
    expect(lossy.grossPay.equals(lossyWithoutBonus.grossPay.plus(dec(50000)))).toBe(true)

    // And it is the same figure in a clean month as in a lossy one.
    const clean = computePayslip(input({ adjustments: [bonus] }))
    const lineIn = (r: typeof clean) =>
      r.breakdown.adjustments.find((l) => l.code === "FESTIVAL_BONUS")?.amount
    expect(lineIn(lossy)).toBe("50000.00")
    expect(lineIn(clean)).toBe("50000.00")
  })
})

describe("a full month of unpaid leave", () => {
  const result = computePayslip(input({ onUnpaidLeave: 31, present: 0, calendarDays: 31 }))

  it("earns nothing", () => {
    expect(result.grossPay.toFixed(2)).toBe("0.00")
    expect(result.payableDays.isZero()).toBe(true)
  })

  it("still owes the fixed deductions", () => {
    expect(result.totalDeductions.toFixed(2)).toBe("7500.00")
  })

  it("returns a negative netPay rather than clamping it to zero", () => {
    // Clamping would hide a real data error — a percentage entered as 50
    // instead of 5 — while quietly not deducting. The caller rejects this.
    expect(result.netPay.isNegative()).toBe(true)
    expect(result.netPay.toFixed(2)).toBe("-7500.00")
  })
})

describe("the month length is the denominator", () => {
  it("gives a different per-day rate in February than in July", () => {
    const feb = computePayslip(input({ calendarDays: 28, onUnpaidLeave: 2, present: 22 }))
    const jul = computePayslip(input({ calendarDays: 31, onUnpaidLeave: 2, present: 24 }))
    // Same salary, same two days lost, different money — because a monthly
    // salary covers the real month.
    expect(feb.grossPay.toFixed(2)).toBe("74285.71")
    expect(jul.grossPay.toFixed(2)).toBe("74838.71")
    expect(feb.grossPay.equals(jul.grossPay)).toBe(false)
  })
})

describe("paid leave never deducts", () => {
  it("treats a month of paid leave as a full month of pay", () => {
    // The whole reason the attendance summary splits paid from unpaid leave.
    const result = computePayslip(input({ onPaidLeave: 5, present: 21 }))
    expect(result.lopDays.isZero()).toBe(true)
    expect(result.grossPay.equals(result.grossFull)).toBe(true)
  })
})

describe("the breakdown document", () => {
  const result = computePayslip(
    input({ absent: 1, onUnpaidLeave: 2, present: 23, reimbursements: [claim("1200.00")] })
  )

  it("puts basic first, then components by sortOrder", () => {
    expect(result.breakdown.earnings.slice(0, 4).map((l) => l.code)).toEqual([
      "BASIC",
      "HOUSE_RENT",
      "MEDICAL",
      "CONVEYANCE",
    ])
  })

  it("shows the pro-ration as its own line, so the lines visibly reconcile", () => {
    const lop = result.breakdown.earnings.find((l) => l.code === "LOP_ADJUSTMENT")
    expect(lop?.amount).toBe("-7741.94")
    expect(lop?.label).toContain("3.00 of 31 days")
  })

  it("records the percentage input alongside the resolved figure", () => {
    const houseRent = result.breakdown.earnings.find((l) => l.code === "HOUSE_RENT")
    expect(houseRent).toMatchObject({ calc: "PERCENT_OF_BASIC", value: "50.00", amount: "25000.00" })
  })

  it("emits every money figure as a 2dp string, never a number", () => {
    // A JSON number is a float again, reintroducing exactly what Decimal was
    // chosen to avoid.
    for (const line of [...result.breakdown.earnings, ...result.breakdown.deductions]) {
      expect(typeof line.amount).toBe("string")
      expect(line.amount).toMatch(/^-?\d+\.\d{2}$/)
    }
  })

  it("freezes the attendance inputs, including the paid/unpaid split", () => {
    expect(result.breakdown.attendance).toEqual({
      calendarDays: 31,
      workingDays: 26,
      present: 23,
      absent: 1,
      onPaidLeave: 0,
      onUnpaidLeave: 2,
      lopDays: 3,
      payableDays: 28,
    })
  })

  it("keeps a reimbursement's own spend-date rate, not the run's", () => {
    expect(result.breakdown.reimbursements[0]).toMatchObject({
      claimId: "claim-1",
      expenseDate: "2026-07-03",
      fxRateToBdt: "1.000000",
      amount: "1200.00",
    })
  })
})

// The private-sector Bangladeshi norm: one negotiated monthly figure with no
// allowance split at all. The engine never needed a change for this — gross
// is basic plus zero earnings — but nothing pinned it, and a structure with
// no components was rejected by the validator until it was allowed.
describe("a flat monthly salary, with no components", () => {
  const flat = () => computePayslip(input({ components: [] }))

  it("pays exactly the negotiated figure", () => {
    const result = flat()
    expect(result.grossFull.toFixed(2)).toBe("50000.00")
    expect(result.grossPay.toFixed(2)).toBe("50000.00")
    expect(result.totalDeductions.toFixed(2)).toBe("0.00")
    expect(result.netPay.toFixed(2)).toBe("50000.00")
  })

  it("shows a single Basic line and no deduction lines", () => {
    const result = flat()
    expect(result.breakdown.earnings.map((l) => l.code)).toEqual(["BASIC"])
    expect(result.breakdown.deductions).toEqual([])
  })

  it("still pro-rates for unpaid absence", () => {
    // 3 of 31 days unpaid → 50,000 × 28/31.
    const result = computePayslip(input({ components: [], absent: 3 }))
    expect(result.grossPay.toFixed(2)).toBe("45161.29")
    expect(result.netPay.toFixed(2)).toBe("45161.29")
    // And the loss is stated as its own line, so the document reconciles.
    expect(result.breakdown.earnings.map((l) => l.code)).toEqual(["BASIC", "LOP_ADJUSTMENT"])
  })

  it("still carries reimbursements outside gross", () => {
    const result = computePayslip(input({ components: [], reimbursements: [claim("2500")] }))
    expect(result.grossPay.toFixed(2)).toBe("50000.00")
    expect(result.netPayable.toFixed(2)).toBe("52500.00")
  })
})

describe("half-day loss of pay", () => {
  // No payroll source change is needed for this — lopDays is already a
  // Decimal and the payslip prints toFixed(2). The assertion exists because
  // this is the money path: a half-day of unpaid leave must cost half a day.
  it("pro-rates half a day of loss of pay", () => {
    const result = computePayslip(input({ onUnpaidLeave: 0.5, present: 25.5 }))
    expect(result.lopDays.toFixed(2)).toBe("0.50")
    expect(result.payableDays.toFixed(2)).toBe("30.50")
  })

  it("keeps payableDays + lopDays === calendarDays across a fraction", () => {
    const result = computePayslip(input({ absent: 0.5, onUnpaidLeave: 0.5, present: 25 }))
    expect(result.payableDays.plus(result.lopDays).toFixed(2)).toBe("31.00")
  })
})

describe("loss of pay switched off (the company pays full salary)", () => {
  it("pays the full month whatever the absence and unpaid leave", () => {
    const result = computePayslip(input({ absent: 1, onUnpaidLeave: 2, deductLossOfPay: false }))
    expect(result.lopDays.toFixed(2)).toBe("0.00")
    expect(result.payableDays.toFixed(2)).toBe("31.00")
    expect(result.grossPay.toFixed(2)).toBe("80000.00")
    expect(result.netPay.toFixed(2)).toBe("72500.00")
  })

  it("adds no loss of pay line", () => {
    const result = computePayslip(input({ absent: 5, deductLossOfPay: false }))
    expect(result.breakdown.earnings.map((line) => line.code)).not.toContain("LOP_ADJUSTMENT")
  })

  it("still records the absence on the payslip", () => {
    const result = computePayslip(input({ absent: 1, onUnpaidLeave: 2, deductLossOfPay: false }))
    expect(result.breakdown.attendance).toMatchObject({ absent: 1, onUnpaidLeave: 2, lopDays: 0, payableDays: 31 })
  })

  it("keeps deducting when the setting is left out or true", () => {
    const left = computePayslip(input({ absent: 1, onUnpaidLeave: 2 }))
    const on = computePayslip(input({ absent: 1, onUnpaidLeave: 2, deductLossOfPay: true }))
    expect(left.grossPay.toFixed(2)).toBe("72258.06")
    expect(on.grossPay.toFixed(2)).toBe("72258.06")
  })
})
