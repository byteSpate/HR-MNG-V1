import type { RequestHandler } from "express"
import { rateLimit } from "express-rate-limit"

interface AuthRateLimitOptions {
  /** Most tries one IP may make in one window. */
  max?: number
  windowMs?: number
  /**
   * Count only refused tries (status 400 and up). For sign-in routes: a whole
   * office signing in at 9am from one IP must not lock itself out. Do not use
   * it where success and failure look the same, such as forgot-password.
   */
  skipSuccessful?: boolean
}

/**
 * Limits sign-in and password-reset tries per IP. Call it once for each route,
 * so each route keeps its own count.
 *
 * `app.ts` sets `trust proxy` to 1, so `req.ip` is the real client on Heroku.
 * The default is 10 tries in 15 minutes: enough for an office behind one IP,
 * too few for a password guesser.
 */
export function createAuthRateLimit({
  max = 10,
  windowMs = 15 * 60 * 1000,
  skipSuccessful = false,
}: AuthRateLimitOptions = {}): RequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    skipSuccessfulRequests: skipSuccessful,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many tries. Wait a few minutes, then try again." })
    },
  })
}
