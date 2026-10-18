/**
 * The API docs page (Swagger UI) at `/api-docs`, and its JSON at
 * `/api-docs/openapi.json`.
 *
 * On by default everywhere except production, where it is off until
 * `API_DOCS=on` is set. The page lists every route and who may call it. That
 * is not a secret, but there is no reason to hand it to strangers either.
 */

import type { Express, Router } from "express"
import swaggerUi from "swagger-ui-express"

import { env } from "../config/env"
import funnelRouter from "../modules/sales/funnel/funnel.routes"
import { buildOpenApi, type Layer, type OpenApiDocument } from "./openapi"

/**
 * The Servers dropdown on the page. The address the page was opened from is
 * listed first, so "Try it out" goes to the same server by default.
 *
 * Calling the other one is a cross-site request, and the browser only allows
 * it when that server's CORS list (`CORS_ORIGINS`) names the page's address.
 */
const DEPLOYED_URL = "https://hr-payroll-server-06ee1f4f0f0f.herokuapp.com"

export function serversFor(current: string): { url: string; description: string }[] {
  const known = [
    // Fixed, not `env.PORT`: Heroku gives the app a random port, and the
    // deployed page would then offer an address nothing listens on.
    { url: "http://localhost:4000", description: "Local" },
    { url: DEPLOYED_URL, description: "Deployed (Heroku)" },
  ]
  const here = known.find((s) => s.url === current)
  if (!here) return [{ url: current, description: "This server" }, ...known]
  return [here, ...known.filter((s) => s !== here)]
}

/** Routers mounted under a path inside another router, not in `app.ts`. */
const NESTED_PREFIXES: [Router, string][] = [[funnelRouter, "/funnel"]]

export function apiDocsEnabled(): boolean {
  if (env.API_DOCS) return env.API_DOCS === "on"
  return process.env.NODE_ENV !== "production"
}

export function mountApiDocs(app: Express, mounts: [string, Router][]): void {
  if (!apiDocsEnabled()) return

  const prefixes = new Map<unknown, string>([
    ...mounts.map(([prefix, router]) => [router, prefix] as [Router, string]),
    ...NESTED_PREFIXES,
  ])

  // Built on the first request, not now: the routes are still being added
  // when this runs. Then kept, because the route table does not change.
  let spec: OpenApiDocument | undefined
  const getSpec = () =>
    (spec ??= buildOpenApi((app as unknown as { router: { stack: Layer[] } }).router.stack, prefixes))

  app.get("/api-docs/openapi.json", (req, res) => {
    res.json({ ...getSpec(), servers: serversFor(`${req.protocol}://${req.get("host")}`) })
  })
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
      customSiteTitle: "HR & Payroll API",
      swaggerOptions: {
        url: "/api-docs/openapi.json",
        persistAuthorization: true,
        docExpansion: "none",
        tryItOutEnabled: true,
      },
    })
  )
}
