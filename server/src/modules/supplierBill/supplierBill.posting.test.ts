import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { buildSupplierBillLines } from "./supplierBill.posting"

const RULES = {
  event: "SUPPLIER_BILL" as const,
  byKey: new Map([
    ["GOODS", "1214"],
    ["SERVICE", "5129"],
    ["VAT", "1233"],
    ["PAYABLE", "2111"],
  ]),
}

describe("buildSupplierBillLines", () => {
  it("debits 1214 for goods, credits 2111 for the gross total", () => {
    const bill = {
      id: "b1",
      supplierId: "sup-1",
      lines: [
        {
          id: "l1", kind: "GOODS" as const, amount: new Prisma.Decimal("800000"),
          vatAmount: new Prisma.Decimal("120000"), opportunityId: "opp-1",
        },
      ],
    }
    const lines = buildSupplierBillLines(bill, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "1214", debit: "800000.00", opportunityId: "opp-1" }),
        expect.objectContaining({ accountCode: "1233", debit: "120000.00", opportunityId: "opp-1" }),
        expect.objectContaining({ accountCode: "2111", credit: "920000.00" }),
      ])
    )
  })

  it("debits 5129 for a service line", () => {
    const bill = {
      id: "b2",
      supplierId: "sup-1",
      lines: [
        {
          id: "l2", kind: "SERVICE" as const, amount: new Prisma.Decimal("50000"),
          vatAmount: new Prisma.Decimal("0"), opportunityId: "opp-2",
        },
      ],
    }
    const lines = buildSupplierBillLines(bill, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "5129", debit: "50000.00", opportunityId: "opp-2" }),
        expect.objectContaining({ accountCode: "2111", credit: "50000.00" }),
      ])
    )
  })
})
