/**
 * Builds an OpenAPI document from the Express route table, so the docs page
 * can never list a route that does not exist or miss one that does.
 *
 * What it knows: the path, the method, the path parameters, whether the route
 * needs a sign-in, and which roles may call it. What it does not know: request
 * and response shapes. The Zod schemas are not tied to routes, so a body is
 * shown as free-form JSON. Read the module's `*.validators.ts` for the fields.
 *
 * Express 5 does not keep the path a router was mounted at. The caller passes
 * it in as `prefixes`, keyed by the router itself. A router mounted under a
 * path that is not in `prefixes` throws, so a new mount fails loudly here
 * instead of putting its routes at the wrong address.
 */

import { requireAuth } from "../middleware/requireAuth"

type Handler = ((...args: never[]) => unknown) & {
  roles?: readonly string[]
  salesRoles?: readonly string[]
}

export interface Layer {
  handle: Handler & { stack?: Layer[] }
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] }
  slash?: boolean
}

export interface OpenApiOperation {
  tags: string[]
  summary: string
  operationId: string
  description?: string
  security?: Record<string, string[]>[]
  parameters?: { name: string; in: "path"; required: true; schema: { type: "string" } }[]
  requestBody?: {
    content: { "application/json": { schema: { type: "object" } } }
  }
  responses: Record<string, { description: string }>
}

export interface OpenApiDocument {
  openapi: "3.0.3"
  info: { title: string; version: string; description: string }
  tags: { name: string }[]
  servers?: { url: string; description: string }[]
  components: {
    securitySchemes: Record<string, { type: "http"; scheme: "bearer"; bearerFormat: "JWT" }>
  }
  paths: Record<string, Record<string, OpenApiOperation>>
}

const BODY_METHODS = new Set(["post", "put", "patch"])
const METHODS = ["get", "post", "put", "patch", "delete"]

/** `/:id/items` becomes `/{id}/items`. */
function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, "{$1}")
}

/** `listLeaveRequestsHandler` becomes "List leave requests". */
function summaryFor(name: string): string {
  const words = name
    .replace(/Handler$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function joinPath(prefix: string, path: string): string {
  const joined = `${prefix}${path === "/" ? "" : path}`
  return joined === "" ? "/" : joined
}

interface Found {
  path: string
  method: string
  stack: Layer[]
}

function collect(
  stack: Layer[],
  prefix: string,
  prefixes: ReadonlyMap<unknown, string>,
  out: Found[]
): void {
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        const verbs = method === "_all" ? METHODS : [method]
        for (const verb of verbs) {
          out.push({
            path: joinPath(prefix, layer.route.path),
            method: verb,
            stack: layer.route.stack,
          })
        }
      }
    } else if (Array.isArray(layer.handle.stack)) {
      const own = prefixes.get(layer.handle)
      if (own === undefined && !layer.slash) {
        throw new Error(
          "A router is mounted under a path that apiDocs does not know. " +
            "Add it to the prefixes passed to buildOpenApi."
        )
      }
      collect(layer.handle.stack, joinPath(prefix, own ?? "/"), prefixes, out)
    }
  }
}

export function buildOpenApi(
  stack: Layer[],
  prefixes: ReadonlyMap<unknown, string>
): OpenApiDocument {
  const found: Found[] = []
  collect(stack, "", prefixes, found)

  const paths: OpenApiDocument["paths"] = {}
  const tags = new Set<string>()

  for (const { path, method, stack: handlers } of found) {
    const openApiPath = toOpenApiPath(path)
    const last = handlers[handlers.length - 1]?.handle
    // Inline and wrapped handlers have no useful name. Show the route instead.
    const name = last?.name
    const named = !!name && name !== "handler" && name !== "<anonymous>"
    const tag = path.split("/")[2] ?? "app"
    tags.add(tag)

    const needsAuth = handlers.some((h) => h.handle === requireAuth)
    const roles = handlers.flatMap((h) => h.handle.roles ?? [])
    const salesRoles = handlers.flatMap((h) => h.handle.salesRoles ?? [])
    const notes: string[] = []
    if (roles.length > 0) notes.push(`Roles: ${roles.join(", ")}.`)
    if (salesRoles.length > 0) notes.push(`Sales roles: ${salesRoles.join(", ")}.`)

    const params = [...path.matchAll(/:(\w+)/g)].map((m) => ({
      name: m[1],
      in: "path" as const,
      required: true as const,
      schema: { type: "string" as const },
    }))

    const operation: OpenApiOperation = {
      tags: [tag],
      summary: named ? summaryFor(name) : `${method.toUpperCase()} ${openApiPath}`,
      operationId: `${method}_${openApiPath.replace(/[^a-zA-Z0-9]+/g, "_")}`,
      responses: { "200": { description: "OK" } },
    }
    if (notes.length > 0) operation.description = notes.join(" ")
    if (needsAuth) {
      operation.security = [{ bearerAuth: [] }]
      operation.responses["401"] = { description: "Not signed in" }
    }
    if (roles.length > 0 || salesRoles.length > 0) {
      operation.responses["403"] = { description: "Role is not allowed" }
    }
    if (params.length > 0) operation.parameters = params
    if (BODY_METHODS.has(method)) {
      operation.requestBody = {
        content: { "application/json": { schema: { type: "object" } } },
      }
    }

    paths[openApiPath] ??= {}
    paths[openApiPath][method] = operation
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "HR & Payroll API",
      version: "1.0.0",
      description:
        "Made from the live route table. To call a protected route, sign in with " +
        "POST /api/auth/login, copy the accessToken, then press Authorize and paste it. " +
        "Request fields are not listed here. See each module's validators file.",
    },
    tags: [...tags].sort().map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
    },
    paths,
  }
}
