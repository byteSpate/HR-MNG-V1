import { describe, expect, it } from "vitest"
import { assertLineKinds, createCustomerPoSchema, updateCustomerPoSchema } from "./customerPo.validators"

const BASE_LINE = { description: "Firewall", quantity: "10", unitPrice: "80000", vatCodeId: "11111111-1111-4111-8111-111111111111" }

function po(over: Record<string, unknown> = {}, lines: Array<Record<string, unknown>> = [{ ...BASE_LINE, kind: "GOODS" }]) {
  return {
    opportunityId: "22222222-2222-4222-8222-222222222222",
    customerPoNumber: "PO-778",
    date: "2026-09-23",
    lines,
    schedule: [],
    ...over,
  }
}

describe("createCustomerPoSchema — Track Delivery off by default", () => {
  it("accepts an untracked PO with no earning kinds", () => {
    const result = createCustomerPoSchema.safeParse(po())
    expect(result.success).toBe(true)
  })
})

describe("assertLineKinds", () => {
  it("refuses a tracked line with no earning kind", () => {
    expect(assertLineKinds(true, [{ kind: "GOODS" }])).toBe("Every line on a PO that tracks delivery needs to say how it is earned")
  })

  it("refuses an untracked line with an earning kind", () => {
    expect(assertLineKinds(false, [{ kind: "GOODS", earnKind: "DELIVERY" }])).toBe(
      "Only a PO that tracks delivery has earning kinds on its lines"
    )
  })

  it("refuses a goods line earned any way other than delivery", () => {
    expect(assertLineKinds(true, [{ kind: "GOODS", earnKind: "ACCEPTANCE" }])).toBe("A goods line is earned when it is delivered")
  })

  it("refuses a service line earned by delivery", () => {
    expect(assertLineKinds(true, [{ kind: "SERVICE", earnKind: "DELIVERY" }])).toBe(
      "A service line is earned by acceptance or monthly, not by delivery"
    )
  })

  it("refuses a monthly line missing either contract date", () => {
    expect(assertLineKinds(true, [{ kind: "SERVICE", earnKind: "MONTHLY", contractStart: "2026-01-01" }])).toBe(
      "A monthly line needs its contract's start and end dates"
    )
  })

  it("refuses a contract that ends before it starts", () => {
    expect(
      assertLineKinds(true, [{ kind: "SERVICE", earnKind: "MONTHLY", contractStart: "2026-12-31", contractEnd: "2026-01-01" }])
    ).toBe("A contract cannot end before it starts")
  })

  it("refuses contract dates on a line that is not monthly", () => {
    expect(assertLineKinds(true, [{ kind: "GOODS", earnKind: "DELIVERY", contractStart: "2026-01-01", contractEnd: "2026-12-31" }])).toBe(
      "Only a monthly line has contract dates"
    )
  })

  it("passes a correctly tracked PO", () => {
    expect(
      assertLineKinds(true, [
        { kind: "GOODS", earnKind: "DELIVERY" },
        { kind: "SERVICE", earnKind: "MONTHLY", contractStart: "2026-01-01", contractEnd: "2026-12-31" },
      ])
    ).toBeNull()
  })
})

describe("createCustomerPoSchema — Track Delivery on", () => {
  it("refuses a tracked PO with a line missing its earning kind, via the shared rule", () => {
    const result = createCustomerPoSchema.safeParse(po({ trackDelivery: true }))
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].message).toBe("Every line on a PO that tracks delivery needs to say how it is earned")
  })

  it("accepts a tracked PO whose lines are all correctly kinded", () => {
    const result = createCustomerPoSchema.safeParse(
      po({ trackDelivery: true }, [
        { ...BASE_LINE, kind: "GOODS", earnKind: "DELIVERY" },
        { ...BASE_LINE, description: "Support", kind: "SERVICE", earnKind: "MONTHLY", contractStart: "2026-01-01", contractEnd: "2026-12-31" },
      ])
    )
    expect(result.success).toBe(true)
  })
})

describe("updateCustomerPoSchema", () => {
  it("does not accept trackDelivery", () => {
    const result = updateCustomerPoSchema.safeParse(po({ trackDelivery: true }))
    expect(result.success).toBe(true)
    if (result.success) expect((result.data as Record<string, unknown>).trackDelivery).toBeUndefined()
  })
})
