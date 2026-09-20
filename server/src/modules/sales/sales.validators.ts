import { z } from "zod"

export const salesDashboardSchema = z.object({
  // A uuid, or the literal "all" for the team roll-up. Documented that way in
  // the plan, so PR D is written against it; a second spelling would be two
  // ways to say one thing.
  employeeId: z.union([z.literal("all"), z.string().uuid("Choose an employee")]).optional(),

})
export type SalesDashboardInput = z.infer<typeof salesDashboardSchema>
