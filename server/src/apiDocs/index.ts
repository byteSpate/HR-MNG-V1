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

  app.get("/api-docs/openapi.json", (_req, res) => {
    res.json(getSpec())
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
