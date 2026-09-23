import { describe, expect, it } from "vitest"
import { Prisma } from "../../generated/prisma/client"
import { buildSupplierCreditNoteLines } from "./supplierCreditNote.posting"

const RULES = {
  event: "SUPPLIER_CREDIT" as const,
  byKey: new Map([
    ["PAYABLE", "2111"],
    ["GOODS", "1214"],
    ["SERVICE", "5129"],
    ["VAT", "1233"],
  ]),
}

describe("buildSupplierCreditNoteLines", () => {
  it("credits 1214 for a GOODS line and debits 2111 for the gross", () => {
    const note = { id: "cn1", supplierId: "sup-1", lines: [{ billLineId: "l1", amount: new Prisma.Decimal("160000"), vatAmount: new Prisma.Decimal("24000") }] }
    const billLines = [{ id: "l1", kind: "GOODS" as const, opportunityId: "opp-1" }]

    const lines = buildSupplierCreditNoteLines(note, billLines, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "2111", debit: "184000.00", supplierId: "sup-1" }),
        expect.objectContaining({ accountCode: "1214", credit: "160000.00", opportunityId: "opp-1" }),
        expect.objectContaining({ accountCode: "1233", credit: "24000.00", opportunityId: "opp-1" }),
      ])
    )
  })

  it("credits 5129 for a SERVICE line", () => {
    const note = { id: "cn2", supplierId: "sup-1", lines: [{ billLineId: "l2", amount: new Prisma.Decimal("30000"), vatAmount: new Prisma.Decimal("0") }] }
    const billLines = [{ id: "l2", kind: "SERVICE" as const, opportunityId: "opp-2" }]

    const lines = buildSupplierCreditNoteLines(note, billLines, RULES)

    expect(lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ accountCode: "5129", credit: "30000.00", opportunityId: "opp-2" }),
        expect.objectContaining({ accountCode: "2111", debit: "30000.00" }),
      ])
    )
  })
})
