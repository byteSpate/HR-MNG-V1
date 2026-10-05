import { describe, expect, it } from "vitest"

import { NO_EMPLOYEE_RECORD, ONLY_FOR_YOURSELF, resolveCreateOwner } from "./account.create-rules"

const USER = { sub: "u-2", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const SUPER = { sub: "u-0", role: "SUPER_ADMIN", salesRole: null } as any

function refusal(fn: () => void) {
  try {
    fn()
  } catch (err) {
    return err
  }
  return null
}

describe("resolveCreateOwner", () => {
  it("makes a Sales User the Owner when they name nobody", () => {
    expect(resolveCreateOwner(undefined, USER, "emp-2")).toBe("emp-2")
  })

  it("accepts a Sales User naming themselves", () => {
    expect(resolveCreateOwner("emp-2", USER, "emp-2")).toBe("emp-2")
  })

  it("refuses a Sales User naming someone else", () => {
    expect(refusal(() => resolveCreateOwner("emp-9", USER, "emp-2"))).toMatchObject({
      statusCode: 403,
      message: ONLY_FOR_YOURSELF,
    })
  })

  it("refuses a Sales User who has no Employee record, with a plain message", () => {
    expect(refusal(() => resolveCreateOwner(undefined, USER, null))).toMatchObject({
      statusCode: 403,
      message: NO_EMPLOYEE_RECORD,
    })
  })

  it("lets a Sales Admin choose any Owner", () => {
    expect(resolveCreateOwner("emp-9", ADMIN, "emp-1")).toBe("emp-9")
    expect(resolveCreateOwner("emp-9", SUPER, null)).toBe("emp-9")
  })

  it("asks a Sales Admin who names nobody to choose one", () => {
    expect(refusal(() => resolveCreateOwner(undefined, ADMIN, "emp-1"))).toMatchObject({
      statusCode: 400,
      message: "Choose an owner",
    })
  })
})
