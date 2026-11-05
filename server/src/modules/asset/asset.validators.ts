import { z } from "zod"

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")

export const createAssetSchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  assetTag: z.string().trim().min(1).max(50).optional(),
  serialNumber: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  purchaseDate: isoDate.optional(),
  purchaseCost: z.coerce.number().min(0).optional(),
  currency: z.enum(["BDT", "USD"]).optional(),
  vendor: z.string().trim().max(200).optional(),
  warrantyExpiry: isoDate.optional(),
  departmentId: z.string().uuid().optional(),
  location: z.string().trim().max(200).optional(),
})

// On an edit, a missing key means "keep" and `null` means "clear". Only the
// optional text fields and the warranty date can be cleared; name, tag and
// serial number keep their rules.
export const updateAssetSchema = createAssetSchema.partial().extend({
  model: createAssetSchema.shape.model.nullable(),
  notes: createAssetSchema.shape.notes.nullable(),
  vendor: createAssetSchema.shape.vendor.nullable(),
  location: createAssetSchema.shape.location.nullable(),
  warrantyExpiry: isoDate.nullable().optional(),
})

// A note is required, not optional. Retiring an asset is a write-off and
// marking one lost is an accusation; neither should be possible without a
// sentence saying why.
export const lifecycleSchema = z.object({
  note: z.string().trim().min(1, "A note is required").max(1000),
  // Decision 4: marking an asset lost is the moment the circumstances are
  // known, so the same dialog offers to price a recovery. Optional — a
  // proportion of losses are nobody's fault, and forcing an amount would
  // produce zero-value recoveries that mean "we did not charge", which is
  // what WAIVED says better.
  recovery: z
    .object({
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Expected a non-negative amount"),
      currency: z.enum(["BDT", "USD"]).optional(),
      reason: z.string().trim().min(1, "A reason is required").max(1000),
      kind: z.enum(["NOT_RETURNED", "DAMAGED", "LOST"]).optional(),
    })
    .optional(),
})

export const createCategorySchema = z.object({
  code: z.string().trim().regex(/^[A-Z_]+$/, "Use upper-case letters and underscores").max(40),
  name: z.string().trim().min(1).max(100),
  requiresSerial: z.boolean().optional(),
  isConsumable: z.boolean().optional(),
  usefulLifeMonths: z.coerce.number().int().min(1).nullable().optional(),
  // Required, not optional-with-a-default. A category whose classification
  // nobody chose is exactly the silent bucket the non-null column exists to
  // prevent.
  classification: z.enum(["IT", "NON_IT"]),
  tracksIndividually: z.boolean().optional(),
})

export const updateCategorySchema = createCategorySchema.partial().omit({ code: true })

export const listAssetsQuery = z.object({
  status: z.enum(["AVAILABLE", "ASSIGNED", "IN_REPAIR", "LOST", "RETIRED"]).optional(),
  categoryId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
})

export const assignSchema = z.object({
  employeeId: z.string().uuid(),
  conditionOut: z.enum(["NEW", "GOOD", "FAIR", "DAMAGED"]),
  issueNote: z.string().trim().max(1000).optional(),
})

export const returnSchema = z.object({
  conditionIn: z.enum(["NEW", "GOOD", "FAIR", "DAMAGED"]),
  returnNote: z.string().trim().max(1000).optional(),
  // Decision 4: same offer as mark-lost, for the other moment the facts are
  // fresh. Only meaningful when conditionIn is DAMAGED.
  recovery: z
    .object({
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Expected a non-negative amount"),
      currency: z.enum(["BDT", "USD"]).optional(),
      reason: z.string().trim().min(1, "A reason is required").max(1000),
      kind: z.enum(["NOT_RETURNED", "DAMAGED", "LOST"]).optional(),
    })
    .optional(),
})

export const sendRepairSchema = z.object({
  fault: z.string().trim().min(1).max(1000),
  vendor: z.string().trim().max(200).optional(),
  expectedBack: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isWarranty: z.boolean().optional(),
})

export const receiveRepairSchema = z.object({
  cost: z.coerce.number().min(0).optional(),
  currency: z.enum(["BDT", "USD"]).optional(),
  outcome: z.string().trim().max(1000).optional(),
  conditionAfter: z.enum(["NEW", "GOOD", "FAIR", "DAMAGED"]).optional(),
})

// A discriminated union rather than one wide object: it makes the invalid
// combinations unrepresentable at the edge, so the service only ever handles
// shapes the CHECK constraints also permit.
export const submitRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("NEW_ITEM"),
    categoryId: z.string().uuid(),
    quantity: z.coerce.number().int().min(1).optional(),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.object({
    kind: z.enum(["REPAIR", "RETURN"]),
    assetId: z.string().uuid(),
    reason: z.string().trim().min(1).max(1000),
  }),
])

export type SubmitRequestInput = z.infer<typeof submitRequestSchema>

// A note is required on reject and optional on approve, matching leave and
// attendance: a rejection nobody explained is one the requester cannot act on.
export const approveRequestSchema = z.object({ note: z.string().trim().max(1000).optional() })
export const rejectRequestSchema = z.object({ note: z.string().trim().min(1).max(1000) })
// assetId is optional because a supply has no asset to name. Which of the two
// applies is decided by the category, in the service, where it is known.
export const fulfilRequestSchema = z.object({
  assetId: z.string().uuid().optional(),
  note: z.string().trim().max(1000).optional(),
})

export const markOrderedSchema = z.object({
  expectedBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date").optional(),
  note: z.string().trim().max(1000).optional(),
})

// Optional in the schema and required in the service when the canceller is not
// the requester — the rule depends on who is asking, which Zod cannot see.
export const cancelRequestSchema = z.object({ note: z.string().trim().max(1000).optional() })

// The attachment kind arrives as a multipart TEXT field alongside the file,
// matching employee.validators.ts's documentTypeSchema — it is validated on
// its own rather than as part of a JSON body.
export const attachmentKindSchema = z.enum([
  "PHOTO",
  "INVOICE",
  "WARRANTY",
  "CONDITION_OUT",
  "CONDITION_IN",
])

export type CreateAssetInput = z.infer<typeof createAssetSchema>
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>
export type CreateCategoryInput = z.infer<typeof createCategorySchema>
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>
export type ListAssetsQuery = z.infer<typeof listAssetsQuery>
export type AssignInput = z.infer<typeof assignSchema>
export type ReturnInput = z.infer<typeof returnSchema>
