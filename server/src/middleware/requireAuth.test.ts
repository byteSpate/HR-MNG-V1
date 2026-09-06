import { describe, expect, it, vi } from "vitest"
import { signAccessToken } from "../modules/auth/auth.utils"
import { requireAuth } from "./requireAuth"

function mockReqRes(authHeader?: string) {
  const req: any = { headers: authHeader ? { authorization: authHeader } : {} }
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  const next = vi.fn()
  return { req, res, next }
}

const basePayload = { sub: "u1", role: "EMPLOYEE" as const, email: "a@b.com", mustChangePassword: false, salesRole: null }

describe("requireAuth", () => {
  it("attaches req.user and calls next() for a valid bearer token", () => {
    const token = signAccessToken(basePayload)
    const { req, res, next } = mockReqRes(`Bearer ${token}`)
    requireAuth(req, res, next)
    expect(req.user?.sub).toBe("u1")
    expect(next).toHaveBeenCalledWith()
  })

  it("calls next(AppError 401) when there is no Authorization header", () => {
    const { req, res, next } = mockReqRes()
    requireAuth(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
  })

  it("calls next(AppError 401) for an invalid token", () => {
    const { req, res, next } = mockReqRes("Bearer not-a-real-token")
    requireAuth(req, res, next)
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }))
  })
})
