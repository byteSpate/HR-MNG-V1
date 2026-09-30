import { z } from "zod"

const answerValue = z.object({
  answer: z.string().trim().max(300, "Keep each answer under 300 characters"),
  detail: z.string().trim().max(300, "Keep each answer under 300 characters").nullable().optional(),
})

const question = z.string().trim().min(1, "Write the question").max(200, "Keep each question under 200 characters")
const ownAnswer = z.string().trim().min(1, "Write the answer").max(500, "Keep each own answer under 500 characters")
// An id that is not an id means the page is out of date, so it says to reload
// rather than "Invalid UUID".
const questionId = z.string().uuid("That question could not be found. Reload the page and try again.")
const TOO_MANY = "Add up to 30 questions at a time"

/**
 * Changing the Company profile. Only what changed is sent: `answers` maps a
 * ready-made question's key to its new answer, or to null to clear it, and
 * absent means leave alone. `custom` adds, updates and removes the account's
 * own questions. What an answer may be depends on its question, so that is
 * checked in `checkAnswer`, not here.
 */
export const updateAccountProfileSchema = z
  .object({
    answers: z.record(z.string().max(60), answerValue.nullable()).optional(),
    custom: z
      .object({
        add: z.array(z.object({ question, answer: ownAnswer })).max(30, TOO_MANY).optional(),
        update: z.array(z.object({ id: questionId, question, answer: ownAnswer })).max(30, TOO_MANY).optional(),
        remove: z.array(questionId).max(30, TOO_MANY).optional(),
      })
      .optional(),
  })
  .refine(
    (body) =>
      Object.keys(body.answers ?? {}).length +
        (body.custom?.add?.length ?? 0) +
        (body.custom?.update?.length ?? 0) +
        (body.custom?.remove?.length ?? 0) >
      0,
    { message: "Nothing was changed" },
  )

export type UpdateAccountProfileBody = z.infer<typeof updateAccountProfileSchema>
