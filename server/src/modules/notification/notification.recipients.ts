/**
 * Who gets told.
 *
 * Kept out of the message builders because the two interesting rules here are
 * about org structure, not about wording, and both have a failure mode worth
 * testing on its own.
 */

import prisma from "../../config/prisma"

async function hrAdminEmails(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { role: "HR_ADMIN", isActive: true },
    select: { email: true },
  })
  return rows.map((r) => r.email)
}

/**
 * The employee's reporting manager, or the HR Admins if there is none.
 *
 * `reportingManagerId` is nullable, and a leave request nobody is told about
 * sits unactioned forever. HR can already approve any request, so the fallback
 * routes it to someone who can act rather than to a dead end. Same when the
 * manager's own login has been deactivated.
 */
export async function recipientsForLeaveRequest(employeeId: string): Promise<string[]> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { reportingManager: { select: { user: { select: { email: true, isActive: true } } } } },
  })
  const manager = employee?.reportingManager?.user
  if (manager?.isActive) return [manager.email]
  return hrAdminEmails()
}

/**
 * Every Super Admin. Fanned out rather than picked, because any of them can
 * approve a payroll run and choosing one makes payday wait on whoever is away.
 */
export async function activeSuperAdminEmails(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true },
    select: { email: true },
  })
  return rows.map((r) => r.email)
}
