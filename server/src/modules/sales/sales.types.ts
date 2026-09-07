import type { SalesAccountStatus, SalesContactStatus } from "../../generated/prisma/client"

export interface SalesAccountSummary {
  id: string
  name: string
  status: SalesAccountStatus
  ownerEmployeeId: string
  ownerName: string
  assigneeCount: number
  createdAt: string
}

export interface SalesContactSummary {
  id: string
  salesAccountId: string
  name: string
  designation: string | null
  phone: string | null
  email: string | null
  isPrimary: boolean
  status: SalesContactStatus
  /** ISO, or null when nobody has reached this person yet. */
  verifiedAt: string | null
  note: string | null
  createdAt: string
}
