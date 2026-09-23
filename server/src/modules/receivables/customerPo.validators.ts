import { z } from "zod"

const positiveMoney = z.string().refine((v) => Number(v) > 0, "Must be greater than zero")
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")

export const poLineSchema = z.object({
  description: z.string().trim().min(1, "A description is required").max(300),
  kind: z.enum(["GOODS", "SERVICE"]),
  quantity: positiveMoney,
  unitPrice: positiveMoney,
  vatCodeId: z.string().uuid(),
  /// Required on every line of a tracked PO, absent on an untracked one.
  earnKind: z.enum(["DELIVERY", "ACCEPTANCE", "MONTHLY"]).optional(),
  contractStart: dateString.optional(),
  contractEnd: dateString.optional(),
})

export const scheduleRowSchema = z.object({
  plannedDate: dateString,
  amount: positiveMoney,
  note: z.string().trim().max(300).optional(),
})

interface LineKindInput {
  kind: "GOODS" | "SERVICE"
  earnKind?: "DELIVERY" | "ACCEPTANCE" | "MONTHLY"
  contractStart?: string
  contractEnd?: string
}

/**
 * Shared between the create schema's superRefine and updateCustomerPo (Task
 * 3), whose schema has no trackDelivery field to refine against — the
 * service checks the new lines against the PO's stored value instead.
 * Returns the first violation's message, or null when every line is right.
 */
export function assertLineKinds(trackDelivery: boolean, lines: LineKindInput[]): string | null {
  for (const line of lines) {
    if (trackDelivery && !line.earnKind) return "Every line on a PO that tracks delivery needs to say how it is earned"
    if (!trackDelivery && line.earnKind) return "Only a PO that tracks delivery has earning kinds on its lines"

    if (!line.earnKind) {
      if (line.contractStart || line.contractEnd) return "Only a monthly line has contract dates"
      continue
    }
    if (line.kind === "GOODS" && line.earnKind !== "DELIVERY") return "A goods line is earned when it is delivered"
    if (line.kind === "SERVICE" && line.earnKind === "DELIVERY") return "A service line is earned by acceptance or monthly, not by delivery"

    if (line.earnKind === "MONTHLY") {
      if (!line.contractStart || !line.contractEnd) return "A monthly line needs its contract's start and end dates"
      if (line.contractEnd < line.contractStart) return "A contract cannot end before it starts"
    } else if (line.contractStart || line.contractEnd) {
      return "Only a monthly line has contract dates"
    }
  }
  return null
}

const customerPoBaseSchema = z.object({
  opportunityId: z.string().uuid(),
  customerPoNumber: z.string().trim().min(1, "A PO number is required").max(100),
  date: dateString,
  invoiceTo: z.string().trim().max(300).optional(),
  /// Set at creation, never changed (spec §2).
  trackDelivery: z.boolean().default(false),
  lines: z.array(poLineSchema).min(1, "At least one line is required"),
  schedule: z.array(scheduleRowSchema).default([]),
})

export const createCustomerPoSchema = customerPoBaseSchema.superRefine((data, ctx) => {
  const message = assertLineKinds(data.trackDelivery, data.lines)
  if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["lines"] })
})

export const updateCustomerPoSchema = customerPoBaseSchema.omit({ opportunityId: true, trackDelivery: true })

export const cancelCustomerPoSchema = z.object({
  reason: z.string().trim().min(1, "Give a reason for cancelling"),
})

export type CreateCustomerPoInput = z.infer<typeof createCustomerPoSchema>
export type UpdateCustomerPoInput = z.infer<typeof updateCustomerPoSchema>
export type CancelCustomerPoInput = z.infer<typeof cancelCustomerPoSchema>
