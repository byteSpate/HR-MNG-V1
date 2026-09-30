import type { AccountProfile, ProfileQuestionView, UpdateAccountProfileBody } from "@/lib/api/types"

/** The most own questions an account can hold. The server enforces the same number. */
export const MAX_CUSTOM_QUESTIONS = 30

/** One row of an account's own questions, as it is being edited. `id` is null for a new row. */
export interface CustomRow {
  id: string | null
  question: string
  answer: string
}

/** Everything the edit dialog holds: an answer box per ready-made question, and the own-question rows. */
export interface ProfileDraft {
  answers: Record<string, { answer: string; detail: string }>
  custom: CustomRow[]
}

export function draftOf(profile: AccountProfile): ProfileDraft {
  const answers: ProfileDraft["answers"] = {}
  for (const group of profile.groups) {
    for (const q of group.questions) answers[q.key] = { answer: q.answer ?? "", detail: q.detail ?? "" }
  }
  return {
    answers,
    custom: profile.custom.map((c) => ({ id: c.id, question: c.question, answer: c.answer })),
  }
}

/** The sentence a viewer reads for an answer, or null when the question is not answered. */
export function answerLine(q: Pick<ProfileQuestionView, "type" | "answer" | "detail">): string | null {
  if (q.answer === null) return null
  if (q.type === "YES_NO") {
    if (q.answer === "NO") return "No"
    return q.detail ? `Yes, ${q.detail}` : "Yes"
  }
  return q.answer
}

/** A sentence when an own-question row has only one of its two boxes filled, else null. */
export function draftProblem(draft: Pick<ProfileDraft, "custom">): string | null {
  for (const row of draft.custom) {
    if ((row.question.trim() === "") !== (row.answer.trim() === "")) {
      return "Fill in both the question and the answer, or remove the row."
    }
  }
  return null
}

/** Only what changed since the profile was loaded, or null when nothing did. */
export function diffProfile(profile: AccountProfile, draft: ProfileDraft): UpdateAccountProfileBody | null {
  const answers: NonNullable<UpdateAccountProfileBody["answers"]> = {}
  for (const group of profile.groups) {
    for (const q of group.questions) {
      const now = draft.answers[q.key] ?? { answer: "", detail: "" }
      const answer = now.answer.trim()
      // A follow-up only belongs to a Yes.
      const detail = q.type === "YES_NO" && answer === "YES" ? now.detail.trim() : ""
      const wasAnswer = q.answer ?? ""
      const wasDetail = q.detail ?? ""
      if (answer === "") {
        if (wasAnswer !== "") answers[q.key] = null
        continue
      }
      if (answer !== wasAnswer || detail !== wasDetail) answers[q.key] = detail ? { answer, detail } : { answer }
    }
  }

  const add: Array<{ question: string; answer: string }> = []
  const update: Array<{ id: string; question: string; answer: string }> = []
  const remove: string[] = []
  const kept = new Set<string>()
  for (const row of draft.custom) {
    const question = row.question.trim()
    const answer = row.answer.trim()
    if (row.id === null) {
      if (question && answer) add.push({ question, answer })
      continue
    }
    kept.add(row.id)
    const original = profile.custom.find((c) => c.id === row.id)
    if (!original) continue
    // Both boxes emptied on a saved row means the person wants it gone.
    if (question === "" && answer === "") remove.push(row.id)
    else if (question !== original.question || answer !== original.answer) update.push({ id: row.id, question, answer })
  }
  for (const c of profile.custom) if (!kept.has(c.id)) remove.push(c.id)

  const body: UpdateAccountProfileBody = {}
  if (Object.keys(answers).length > 0) body.answers = answers
  const custom = {
    ...(add.length > 0 ? { add } : {}),
    ...(update.length > 0 ? { update } : {}),
    ...(remove.length > 0 ? { remove } : {}),
  }
  if (Object.keys(custom).length > 0) body.custom = custom
  return Object.keys(body).length > 0 ? body : null
}

/** The body for the create form: only its filled rows, as new own questions. Null when there are none. */
export function customAdds(rows: CustomRow[]): UpdateAccountProfileBody | null {
  const add = rows
    .map((r) => ({ question: r.question.trim(), answer: r.answer.trim() }))
    .filter((r) => r.question !== "" && r.answer !== "")
  return add.length > 0 ? { custom: { add } } : null
}
