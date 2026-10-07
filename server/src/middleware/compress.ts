import compression from "compression"

/**
 * Gzip for API answers.
 *
 * The data is JSON with the same keys on every row, which gzip shrinks a lot.
 * Below 1 KB the saving is smaller than the cost, so small bodies are sent as
 * they are. Heroku's router does not compress for us.
 */
export function compressResponses() {
  return compression({ threshold: 1024 })
}
