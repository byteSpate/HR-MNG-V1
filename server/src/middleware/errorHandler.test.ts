import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { AppError, errorHandler } from "./errorHandler"

function mockRes() {
  const res: any = {}
  res.status = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

describe("errorHandler", () => {
  it("responds with the AppError's status code and message", () => {
    const res = mockRes()
    errorHandler(new AppError(404, "Not found"), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: "Not found" })
  })

  it("responds 500 with a generic message for unknown errors", () => {
    const res = mockRes()
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    errorHandler(new Error("boom"), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" })
    consoleSpy.mockRestore()
  })
})

function prismaError(code: string) {
  const err = new Error(`prisma ${code}`) as Error & { code: string }
  err.name = "PrismaClientKnownRequestError"
  err.code = code
  return err
}

describe("errorHandler: Prisma errors", () => {
  it("P2002 becomes 409", () => {
    const res = mockRes()
    errorHandler(prismaError("P2002"), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: "This value is already used. Change it and try again." })
  })

  it("P2025 becomes 404", () => {
    const res = mockRes()
    errorHandler(prismaError("P2025"), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({
      error: "We could not find this record. Refresh the page and try again.",
    })
  })

  it("P2003 becomes 400", () => {
    const res = mockRes()
    errorHandler(prismaError("P2003"), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      error: "This record is linked to another record that does not exist. Check the link and try again.",
    })
  })

  it("another Prisma code stays 500 and is logged", () => {
    const res = mockRes()
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    errorHandler(prismaError("P2024"), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("a service AppError still wins", () => {
    const res = mockRes()
    errorHandler(new AppError(409, "x"), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: "x" })
  })
})

describe("errorHandler: Zod messages in easy English", () => {
  it("an empty string field says it cannot be empty", () => {
    const res = mockRes()
    const parsed = z.object({ name: z.string().min(1) }).safeParse({ name: "" })
    errorHandler(parsed.error, {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: "name: Write a value. This cannot be empty." })
  })

  it("a missing field says it is needed", () => {
    const res = mockRes()
    const parsed = z.object({ name: z.string() }).safeParse({})
    errorHandler(parsed.error, {} as any, res, vi.fn())
    expect(res.json).toHaveBeenCalledWith({ error: "name: This is needed." })
  })

  it("an unknown issue passes through unchanged", () => {
    const res = mockRes()
    const parsed = z
      .object({ a: z.string() })
      .superRefine((_v, ctx) => ctx.addIssue({ code: "custom", message: "Pick a date in the past." }))
      .safeParse({ a: "x" })
    errorHandler(parsed.error, {} as any, res, vi.fn())
    expect(res.json).toHaveBeenCalledWith({ error: "Pick a date in the past." })
  })
})
