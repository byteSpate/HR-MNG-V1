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

  it("a mapped Prisma error is still logged, with its code and the field", () => {
    const res = mockRes()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const err = Object.assign(prismaError("P2002"), { meta: { target: ["serialNumber"] } })
    errorHandler(err, {} as any, res, vi.fn())
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("P2002"), expect.anything())
    warn.mockRestore()
  })

  it("a service AppError still wins", () => {
    const res = mockRes()
    errorHandler(new AppError(409, "x"), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: "x" })
  })
})

describe("errorHandler: a body that is too large", () => {
  it("becomes 413 with an easy English sentence, not a 500", () => {
    const res = mockRes()
    const err = Object.assign(new Error("request entity too large"), { type: "entity.too.large", status: 413 })
    errorHandler(err, {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(413)
    expect(res.json).toHaveBeenCalledWith({ error: "This request is too big. Send less data and try again." })
  })
})

describe("errorHandler: other client mistakes from body-parser", () => {
  const httpError = (message: string, type: string, status: number) =>
    Object.assign(new Error(message), { type, status, expose: true })

  it("malformed JSON is a 400 with an easy English sentence, not a 500", () => {
    const res = mockRes()
    errorHandler(httpError("Unexpected token", "entity.parse.failed", 400), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: "We could not read this request. Check it and try again." })
  })

  it("an unsupported charset or encoding is a 415", () => {
    for (const type of ["charset.unsupported", "encoding.unsupported"]) {
      const res = mockRes()
      errorHandler(httpError("x", type, 415), {} as any, res, vi.fn())
      expect(res.status).toHaveBeenCalledWith(415)
      expect(res.json).toHaveBeenCalledWith({ error: "This kind of request is not supported. Check it and try again." })
    }
  })

  it("a request that was cut off is a 400", () => {
    const res = mockRes()
    errorHandler(httpError("request aborted", "request.aborted", 400), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it("any other exposed 4xx keeps its status and gets a plain sentence", () => {
    const res = mockRes()
    errorHandler(httpError("x", "something.else", 431), {} as any, res, vi.fn())
    expect(res.status).toHaveBeenCalledWith(431)
    expect(res.json).toHaveBeenCalledWith({ error: "This request could not be used. Check it and try again." })
  })

  it("a 5xx error, or a 4xx that is not safe to show, stays a logged 500", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const err of [
      Object.assign(new Error("db down"), { status: 503, expose: false }),
      Object.assign(new Error("secret"), { status: 400, expose: false }),
    ]) {
      const res = mockRes()
      errorHandler(err, {} as any, res, vi.fn())
      expect(res.status).toHaveBeenCalledWith(500)
    }
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
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

  it("a null where a value is needed says it cannot be cleared", () => {
    const res = mockRes()
    const parsed = z.object({ name: z.string() }).safeParse({ name: null })
    errorHandler(parsed.error, {} as any, res, vi.fn())
    expect(res.json).toHaveBeenCalledWith({ error: "name: This needs a value. Write one." })
  })

  it("a message the validator wrote itself is kept", () => {
    const res = mockRes()
    const parsed = z.object({ note: z.string().min(1, "A note is required") }).safeParse({ note: "" })
    errorHandler(parsed.error, {} as any, res, vi.fn())
    expect(res.json).toHaveBeenCalledWith({ error: "note: A note is required" })
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
