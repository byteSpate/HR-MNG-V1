import type { NextFunction, Request, Response } from "express"
import { ZodError } from "zod"

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    /**
     * Extra JSON fields merged alongside `error` in the response — the
     * payroll preflight's `{ error, blockers }` 409 is the first consumer.
     * Optional and additive: every existing `new AppError(status, message)`
     * call site is unaffected.
     */
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = "AppError"
  }
}

/**
 * Turns a Zod failure into the first issue, prefixed with the field it came
 * from: `startDate: Expected a YYYY-MM-DD date`.
 *
 * One issue rather than all of them, because the client renders this as a
 * single inline string; the field prefix is what makes it actionable.
 */
function validationMessage(err: ZodError): string {
  const issue = err.issues[0]
  if (!issue) return "Invalid request"
  const field = issue.path.join(".")
  const message = plainIssueMessage(issue) ?? issue.message
  return field ? `${field}: ${message}` : message
}

/**
 * Plain words for the two Zod messages users meet most. Anything else is
 * returned as null, so the caller keeps Zod's own text.
 */
function plainIssueMessage(issue: ZodError["issues"][number]): string | null {
  // Only Zod's own default wording is replaced. A validator that wrote its
  // own message ("A note is required") keeps it.
  const isZodDefault = issue.message.startsWith("Too small:") || issue.message.startsWith("Invalid input:")
  if (!isZodDefault) return null
  if (issue.code === "too_small" && issue.origin === "string" && Number(issue.minimum) === 1) {
    return "Write a value. This cannot be empty."
  }
  if (issue.code === "invalid_type" && /received undefined/.test(issue.message)) {
    return "This is needed."
  }
  if (issue.code === "invalid_type" && /received null/.test(issue.message)) {
    return "This needs a value. Write one."
  }
  return null
}

/**
 * The central answer to a Prisma failure that a service did not catch.
 * Detected by name and `code`, so this file does not import the generated
 * client. Any other code returns null and falls through to the 500.
 */
function prismaErrorResponse(err: unknown): { status: number; error: string } | null {
  if (!(err instanceof Error) || err.name !== "PrismaClientKnownRequestError") return null
  switch ((err as { code?: unknown }).code) {
    case "P2002":
      return { status: 409, error: "This value is already used. Change it and try again." }
    case "P2025":
      return { status: 404, error: "We could not find this record. Refresh the page and try again." }
    case "P2003":
      return {
        status: 400,
        error: "This record is linked to another record that does not exist. Check the link and try again.",
      }
    default:
      return null
  }
}

/**
 * Errors that body-parser (and other `http-errors` users) throw for a bad
 * request. They carry a `type` and an HTTP `status`. Known types get their own
 * sentence. Any other 4xx marked `expose` keeps its status. A 5xx, or a 4xx not
 * safe to show, returns null and falls through to the logged 500.
 */
function clientHttpErrorResponse(err: unknown): { status: number; error: string } | null {
  if (!(err instanceof Error)) return null
  const e = err as { type?: unknown; status?: unknown; statusCode?: unknown; expose?: unknown }
  switch (e.type) {
    case "entity.too.large":
      return { status: 413, error: "This request is too big. Send less data and try again." }
    case "entity.parse.failed":
    case "request.aborted":
    case "request.size.invalid":
      return { status: 400, error: "We could not read this request. Check it and try again." }
    case "charset.unsupported":
    case "encoding.unsupported":
      return { status: 415, error: "This kind of request is not supported. Check it and try again." }
  }
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : null
  if (status !== null && status >= 400 && status < 500 && e.expose === true) {
    return { status, error: "This request could not be used. Check it and try again." }
  }
  return null
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, ...err.details })
  }
  // Controllers call `schema.parse(...)` and pass the throw to next(), so
  // without this branch every malformed request body or query string
  // surfaced as a 500 — an input mistake reported as a server fault, with
  // the real reason buried in the server log.
  if (err instanceof ZodError) {
    return res.status(400).json({ error: validationMessage(err) })
  }
  // body-parser and http-errors failures (a body that is too big, broken JSON,
  // an unsupported format) are the sender's mistake, so they are 4xx and not 500.
  const clientError = clientHttpErrorResponse(err)
  if (clientError) return res.status(clientError.status).json({ error: clientError.error })
  const prismaResponse = prismaErrorResponse(err)
  if (prismaResponse) {
    // Not a 500, but still worth a line in the log: the message above cannot
    // say which field clashed, and a P2025 inside a nested write is a bug.
    console.warn(`[prisma ${(err as { code?: string }).code}] ${req.method} ${req.originalUrl}`, (err as { meta?: unknown }).meta ?? {})
    return res.status(prismaResponse.status).json({ error: prismaResponse.error })
  }
  console.error(err)
  return res.status(500).json({ error: "Internal server error" })
}
