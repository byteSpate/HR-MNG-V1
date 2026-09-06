import type { SalesAccountStatus } from "../../generated/prisma/client"

export interface SalesAccountSummary {
  id: string
  name: string
  status: SalesAccountStatus
  ownerEmployeeId: string
  ownerName: string
  assigneeCount: number
  createdAt: string
}
