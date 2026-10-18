/**
 * The Heatmap band on the Sales dashboard (owner, 2026-10-18): for each
 * product, how many accounts are Green, how many are Red and how many are
 * not checked, so a manager can see where the company can sell.
 *
 * Who is counted follows the dashboard's own rule. A person sees their own
 * accounts; the whole team, or somebody else, needs `team.dashboard`. The
 * colour of a product on an account is `productColour`, the same function the
 * Heatmap tab uses, so the two can never disagree.
 */

import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { employeeIdFor } from "../sales.access"
import { canDo } from "../sales.permissions"
import type { HeatmapOverview, HeatmapOverviewAccount } from "../sales.types"
import { productColour, type PartMark } from "../heatmap/heatmap.colour"
import { ALL_EMPLOYEES } from "./dashboard.service"
import type { SalesDashboardInput } from "./dashboard.validators"

const ORDER = [{ position: "asc" as const }, { id: "asc" as const }]

export async function getHeatmapOverview(query: SalesDashboardInput, actor: AccessTokenPayload): Promise<HeatmapOverview> {
  const ownEmployeeId = await employeeIdFor(actor)
  const wantsTeam = query.employeeId === ALL_EMPLOYEES
  const wantsOther = !!query.employeeId && !wantsTeam && query.employeeId !== ownEmployeeId
  if ((wantsTeam || wantsOther) && !(await canDo(actor, "team.dashboard"))) {
    throw new AppError(403, wantsTeam ? "You cannot see the whole team. Ask a Sales Admin." : "You can only see your own dashboard")
  }

  let employeeName = "Everyone"
  let owner: { ownerEmployeeId: string } | Record<string, never> = {}
  if (!wantsTeam) {
    const subjectId = query.employeeId ?? ownEmployeeId
    if (!subjectId) {
      throw new AppError(
        400,
        "Your account has no employee record, so it has no accounts of its own. Choose an employee instead.",
      )
    }
    const employee = await prisma.employee.findUnique({ where: { id: subjectId }, select: { id: true, fullName: true } })
    if (!employee) throw new AppError(404, "That employee does not exist")
    employeeName = employee.fullName
    owner = { ownerEmployeeId: employee.id }
  }

  const [groups, accounts] = await Promise.all([
    prisma.heatmapGroup.findMany({
      where: { hidden: false },
      orderBy: ORDER,
      select: {
        title: true,
        products: {
          where: { hidden: false },
          orderBy: ORDER,
          select: { id: true, title: true, parts: { where: { hidden: false }, select: { id: true } } },
        },
      },
    }),
    prisma.salesAccount.findMany({
      where: { status: "ACTIVE", ...owner },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ])
  const marks = accounts.length
    ? await prisma.salesAccountHeatmapMark.findMany({
        where: { salesAccountId: { in: accounts.map((a) => a.id) } },
        select: { salesAccountId: true, partId: true, state: true },
      })
    : []
  const byAccount = new Map<string, Map<string, "GREEN" | "RED">>()
  for (const m of marks) {
    const own = byAccount.get(m.salesAccountId) ?? new Map<string, "GREEN" | "RED">()
    own.set(m.partId, m.state)
    byAccount.set(m.salesAccountId, own)
  }

  const shownParts = new Set(groups.flatMap((g) => g.products.flatMap((p) => p.parts.map((x) => x.id))))
  const checkedAccounts = accounts.filter((a) => [...(byAccount.get(a.id)?.keys() ?? [])].some((id) => shownParts.has(id))).length

  const products = groups.flatMap((g) =>
    g.products.map((p) => {
      const greenAccounts: HeatmapOverviewAccount[] = []
      const redAccounts: HeatmapOverviewAccount[] = []
      for (const a of accounts) {
        const own = byAccount.get(a.id)
        const colour = productColour(p.parts.map((x): PartMark => own?.get(x.id) ?? null))
        if (colour === "GREEN") greenAccounts.push({ id: a.id, name: a.name })
        else if (colour === "RED") redAccounts.push({ id: a.id, name: a.name })
      }
      return {
        id: p.id,
        title: p.title,
        groupTitle: g.title,
        green: greenAccounts.length,
        red: redAccounts.length,
        notChecked: accounts.length - greenAccounts.length - redAccounts.length,
        greenAccounts,
        redAccounts,
      }
    }),
  )

  return { employeeName, accounts: accounts.length, checkedAccounts, products }
}
