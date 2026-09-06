export interface SalesAccountSummary {
  id: string
  name: string
  status: "ACTIVE" | "INACTIVE" | "DO_NOT_CONTACT"
  ownerEmployeeId: string
  ownerName: string
  assigneeCount: number
  createdAt: string
}
