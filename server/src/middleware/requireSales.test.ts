import { describe, expect, it, vi } from "vitest"

import { AppError } from "./errorHandler"
import { requireSales } from "./requireSales"

function run(user: any, roles: any[] = []) {
  const next = vi.fn()
  requireSales(...roles)({ user } as any, {} as any, next)
  return next.mock.calls[0][0]
}

describe("requireSales", () => {
  it("401s when nobody is authenticated", () => {
    const err = run(undefined)
    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).statusCode).toBe(401)
  })

  it("403s when the user has no salesRole at all", () => {
    const err = run({ role: "EMPLOYEE", salesRole: null })
    expect((err as AppError).statusCode).toBe(403)
  })

  it("403s when an older actor fixture omits salesRole", () => {
    const err = run({ role: "EMPLOYEE" })
    expect((err as AppError).statusCode).toBe(403)
  })

  it("passes any sales role through when no specific role is demanded", () => {
    expect(run({ role: "EMPLOYEE", salesRole: "SALES_USER" })).toBeUndefined()
  })

  it("403s a Sales User on an admin-only route", () => {
    const err = run({ role: "EMPLOYEE", salesRole: "SALES_USER" }, ["SALES_ADMIN"])
    expect((err as AppError).statusCode).toBe(403)
  })

  it("lets a Sales Admin through an admin-only route", () => {
    expect(run({ role: "EMPLOYEE", salesRole: "SALES_ADMIN" }, ["SALES_ADMIN"])).toBeUndefined()
  })

  it("treats SUPER_ADMIN as a Sales Admin with no salesRole set", () => {
    expect(run({ role: "SUPER_ADMIN", salesRole: null }, ["SALES_ADMIN"])).toBeUndefined()
  })

  it("does not extend the same courtesy to HR_ADMIN", () => {
    const err = run({ role: "HR_ADMIN", salesRole: null })
    expect((err as AppError).statusCode).toBe(403)
  })
})
