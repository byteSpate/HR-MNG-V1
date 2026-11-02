import type { SalesTaskType } from "@/lib/api/types"

/**
 * What kind of work a task records (owner, 2026-11-02). The task is also the
 * daily log, so every task has a type, with or without an account. Same order
 * as the server's `SalesTaskType` enum, kept by hand like the other lists in
 * `lib/api/types.ts`.
 */
export const TASK_TYPES: readonly SalesTaskType[] = [
  "VISIT_FOLLOW_UP",
  "QUOTATION_SENT",
  "REQUIREMENT_SENT",
  "CALL_OR_EMAIL",
  "LEARNING",
  "INTERNAL_WORK",
  "OTHER",
]

export const TASK_TYPE_LABEL: Record<SalesTaskType, string> = {
  VISIT_FOLLOW_UP: "Visit follow-up",
  QUOTATION_SENT: "Quotation sent",
  REQUIREMENT_SENT: "Requirement sent",
  CALL_OR_EMAIL: "Call or email",
  LEARNING: "Learning",
  INTERNAL_WORK: "Internal work",
  OTHER: "Other",
}
