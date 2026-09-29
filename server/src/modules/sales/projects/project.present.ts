import { dec, sum, toMoneyString, type MoneyInput } from "../../payroll/payroll.money"
import { officeDateOf } from "../../attendance/attendance.time"
import { marginAmount } from "../sales.margin"
import type { AccessTokenPayload } from "../../auth/auth.types"
import type { ProjectSummary } from "../sales.types"
import { canManageProject, peopleOf, type ProjectRow } from "./project.access"
import { healthOf, peopleNumbers, progressOf } from "./project.numbers"

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const moneyOrNull = (v: MoneyInput | null | undefined) => (v == null ? null : toMoneyString(dec(v)))

/**
 * Total price minus margin, added up over the lines (spec §1.7). Null, never
 * ৳0, when there are no lines or any line lacks a price or a margin.
 */
export function plannedCostOf(lines: Array<{ lineValue: MoneyInput | null; marginPercent: MoneyInput | null }>): string | null {
  if (lines.length === 0) return null
  if (lines.some((l) => l.lineValue == null || l.marginPercent == null)) return null
  return toMoneyString(sum(lines.map((l) => dec(l.lineValue!).minus(marginAmount(l.lineValue, l.marginPercent)!))))
}

export function presentProject(
  row: ProjectRow,
  ctx: { actor: AccessTokenPayload; employeeId: string | null; spentSoFar: string | null; canSeeCost: boolean; tickNames: Map<string, string> }
): ProjectSummary {
  const people = peopleOf(row.salesAccount)
  const canManage = canManageProject(ctx.actor, ctx.employeeId, row.managerEmployeeId)
  const onTeam = ctx.employeeId !== null && row.team.some((m) => m.employeeId === ctx.employeeId)
  const today = officeDateOf(new Date())
  // The Project Manager and the team, each once. A manager who is also on the
  // team is one person, not two rows of work.
  const everyone = [
    { employeeId: row.manager.id, fullName: row.manager.fullName },
    ...row.team.map((m) => ({ employeeId: m.employeeId, fullName: m.employee.fullName })),
  ].filter((p, i, all) => all.findIndex((x) => x.employeeId === p.employeeId) === i)
  return {
    id: row.id, serial: row.serial, name: row.name,
    opportunity: { id: row.opportunity.id, serial: row.opportunity.serial, name: row.opportunity.name, track: row.opportunity.track },
    salesAccount: { id: row.salesAccount.id, name: row.salesAccount.name },
    manager: { employeeId: row.manager.id, fullName: row.manager.fullName, onAccount: people.has(row.manager.id) },
    team: row.team.map((m) => ({
      employeeId: m.employeeId, fullName: m.employee.fullName, responsibility: m.responsibility, onAccount: people.has(m.employeeId),
    })),
    startOn: day(row.startOn), dueOn: day(row.dueOn), priority: row.priority,
    budget: moneyOrNull(row.budget),
    value: moneyOrNull(row.opportunity.amount),
    plannedCost: plannedCostOf(row.opportunity.lines),
    spentSoFar: ctx.canSeeCost ? ctx.spentSoFar : null,
    canSeeCost: ctx.canSeeCost,
    status: row.status, statusReason: row.statusReason,
    completedAt: row.completedAt?.toISOString() ?? null,
    milestones: row.milestones.map((m) => ({ id: m.id, title: m.title, dueOn: day(m.dueOn), doneAt: m.doneAt?.toISOString() ?? null, order: m.order })),
    // How it is going (spec §2.3), worked out from the Project's own tasks.
    progress: progressOf(row.tasks),
    people: peopleNumbers(row.tasks, everyone, today),
    health: healthOf(row, row.tasks, today),
    openTaskCount: row.tasks.filter((t) => t.status === "PENDING").length,
    lines: row.opportunity.lines.map((l) => {
      const tick = l.projectTicks.find((t) => t.projectId === row.id)
      return {
        id: l.id, product: l.product, oemBrand: l.oemBrand, model: l.model, quantity: l.quantity,
        // "What it covers" on a Software Opportunity's Modules (spec §2.4).
        note: l.note ?? null,
        supplierName: l.supplier?.name ?? null,
        lineValue: moneyOrNull(l.lineValue),
        marginPercent: l.marginPercent == null ? null : dec(l.marginPercent).toFixed(2),
        done: tick ? { at: tick.doneAt.toISOString(), byName: ctx.tickNames.get(tick.doneBy) ?? null } : null,
      }
    }),
    canManage,
    canTick: canManage || onTeam,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  }
}
