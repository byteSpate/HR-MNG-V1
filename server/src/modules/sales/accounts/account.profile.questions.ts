import { AppError } from "../../../middleware/errorHandler"

/**
 * The ready-made questions on an account's Company profile (spec 2026-09-30).
 *
 * The list lives here and nowhere else. The server sends it to the page with
 * the answers, so the wording is never copied into the client, and an answer
 * row stores only the `key`. To add a question, add it here. To reword one,
 * change its text: answers stay attached because they point at the key.
 * Never reuse a key for a different question.
 *
 * Every word is read by people whose first language is often not English, so
 * these are short and plain (see CLAUDE.md, Easy English).
 */

export type ProfileQuestionType = "YES_NO" | "TEXT" | "NUMBER" | "CHOICE"

export const PROFILE_GROUPS = [
  { key: "offices", title: "Offices and sites" },
  { key: "it", title: "IT setup" },
  { key: "buying", title: "How they buy" },
  { key: "vendors", title: "Current vendors" },
  { key: "plans", title: "Plans" },
] as const

export type ProfileGroupKey = (typeof PROFILE_GROUPS)[number]["key"]

export interface ProfileQuestion {
  key: string
  group: ProfileGroupKey
  text: string
  type: ProfileQuestionType
  /** Yes/No only: the follow-up asked when the answer is Yes. */
  detailLabel?: string
  /** Pick list only. */
  options?: readonly string[]
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const

export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  // Offices and sites
  { key: "branches", group: "offices", type: "YES_NO", text: "Does the company have branches?", detailLabel: "Where are they, and how many?" },
  { key: "staff", group: "offices", type: "NUMBER", text: "How many people work in the company?" },
  { key: "serverRoom", group: "offices", type: "YES_NO", text: "Is there a data centre or server room?", detailLabel: "Where is it?" },
  // IT setup
  { key: "servers", group: "it", type: "YES_NO", text: "Does the company have servers?", detailLabel: "How many, and which brand?" },
  { key: "switches", group: "it", type: "YES_NO", text: "Does the company use network switches?", detailLabel: "Which brand, how many, and are they managed?" },
  { key: "firewall", group: "it", type: "YES_NO", text: "Does the company have a firewall?", detailLabel: "Which brand?" },
  { key: "wifi", group: "it", type: "YES_NO", text: "Does the company have Wi-Fi access points?", detailLabel: "Which brand, and how many?" },
  { key: "cctv", group: "it", type: "YES_NO", text: "Is CCTV installed?", detailLabel: "Which brand, and how many cameras?" },
  { key: "cabling", group: "it", type: "CHOICE", text: "What kind of cabling does the company use?", options: ["Copper", "Fibre", "Both", "Not sure"] },
  { key: "internet", group: "it", type: "TEXT", text: "Who is the internet provider, and how fast is the line?" },
  { key: "backupLine", group: "it", type: "YES_NO", text: "Is there a backup internet line?", detailLabel: "Which provider?" },
  { key: "dataBackup", group: "it", type: "YES_NO", text: "Is there a data backup or storage system?", detailLabel: "Which one?" },
  { key: "software", group: "it", type: "TEXT", text: "Which main software does the company use? For example ERP, email or accounts." },
  // How they buy
  { key: "decider", group: "buying", type: "TEXT", text: "Who decides on a purchase?" },
  { key: "approver", group: "buying", type: "TEXT", text: "Who approves the money?" },
  { key: "budgetMonth", group: "buying", type: "CHOICE", text: "When does the budget year start?", options: MONTHS },
  { key: "buyMethod", group: "buying", type: "CHOICE", text: "How does the company buy?", options: ["Tender", "Direct purchase", "Both"] },
  { key: "paymentTerms", group: "buying", type: "TEXT", text: "What are the usual payment terms?" },
  // Current vendors
  { key: "vendors", group: "vendors", type: "TEXT", text: "Which OEMs or vendors does the company use now?" },
  { key: "supportContract", group: "vendors", type: "YES_NO", text: "Is a support contract running?", detailLabel: "With whom, and when does it end?" },
  // Plans
  { key: "upgradePlanned", group: "plans", type: "YES_NO", text: "Is any upgrade or expansion planned?", detailLabel: "What, and when?" },
]

export const QUESTION_BY_KEY: Map<string, ProfileQuestion> = new Map(PROFILE_QUESTIONS.map((q) => [q.key, q]))

/**
 * Checks one answer against its question and returns what to store. The Zod
 * schema only checks the shape; what an answer may be depends on the
 * question, so it is decided here, and every refusal says what to do next.
 */
export function checkAnswer(
  q: ProfileQuestion,
  input: { answer: string; detail?: string | null },
): { answer: string; detail: string | null } {
  const answer = input.answer.trim()
  const detail = input.detail?.trim() || null
  if (answer === "") throw new AppError(400, `Write an answer for "${q.text}", or clear it.`)
  if (q.type !== "YES_NO" && detail) {
    throw new AppError(400, `"${q.text}" has no follow-up part. Put everything in the answer.`)
  }
  switch (q.type) {
    case "YES_NO":
      if (answer !== "YES" && answer !== "NO") throw new AppError(400, `Answer "${q.text}" with Yes or No.`)
      // A No has nothing to explain, so a detail sent with it is dropped.
      return { answer, detail: answer === "YES" ? detail : null }
    case "NUMBER":
      if (!/^\d{1,7}$/.test(answer)) throw new AppError(400, `"${q.text}" needs a whole number, like 25.`)
      return { answer, detail: null }
    case "CHOICE":
      if (!q.options!.includes(answer)) throw new AppError(400, `Choose one of: ${q.options!.join(", ")}. The question is "${q.text}".`)
      return { answer, detail: null }
    case "TEXT":
      return { answer, detail: null }
  }
}

/** An answer as a person reads it, for the account History. */
export function answerText(q: ProfileQuestion, answer: string, detail: string | null): string {
  if (q.type === "YES_NO") {
    if (answer === "NO") return "No"
    return detail ? `Yes, ${detail}` : "Yes"
  }
  return answer
}
