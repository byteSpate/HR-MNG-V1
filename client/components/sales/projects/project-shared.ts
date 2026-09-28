import type { ProjectStatus } from "@/lib/api/types"
import type { Tone } from "@/components/dashboard/types"

export const PROJECT_STATUSES: ProjectStatus[] = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "ON_HOLD", "COMPLETED", "CANCELLED"]

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
}

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "neutral",
  BLOCKED: "red",
  ON_HOLD: "yellow",
  COMPLETED: "green",
  CANCELLED: "neutral",
}

/** The statuses that need a reason, and the label for the reason box. */
export const REASON_NEEDED: Partial<Record<ProjectStatus, string>> = {
  BLOCKED: "What is blocking it?",
  ON_HOLD: "Why is it on hold?",
  CANCELLED: "Why is it cancelled?",
}

export const PRIORITY_LABEL = { LOW: "Low", NORMAL: "Normal", HIGH: "High" } as const
