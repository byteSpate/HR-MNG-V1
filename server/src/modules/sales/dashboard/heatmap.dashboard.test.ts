import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/prisma", () => ({
  default: {
    employee: { findUnique: vi.fn() },
    heatmapGroup: { findMany: vi.fn() },
    salesAccount: { findMany: vi.fn() },
    salesAccountHeatmapMark: { findMany: vi.fn() },
  },
}))
vi.mock("../sales.access", () => ({ employeeIdFor: vi.fn() }))
vi.mock("../sales.permissions", () => ({ canDo: vi.fn() }))
vi.mock("./dashboard.service", () => ({ ALL_EMPLOYEES: "all" }))

import prisma from "../../../config/prisma"
import { employeeIdFor } from "../sales.access"
import { canDo } from "../sales.permissions"
import { getHeatmapOverview } from "./heatmap.dashboard"

const USER = { sub: "user-1", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const OTHER_ID = "22222222-2222-4222-8222-222222222222"

const GROUPS = [
  {
    title: "Network",
    products: [
      { id: "prod-router", title: "Router", parts: [{ id: "p-small" }, { id: "p-mid" }] },
      { id: "prod-switch", title: "Switch", parts: [{ id: "p-sw" }] },
    ],
  },
]
const ACCOUNTS = [{ id: "acc-a", name: "Alpha Ltd" }, { id: "acc-b", name: "Beta Ltd" }, { id: "acc-c", name: "Gamma Ltd" }]
const mark = (salesAccountId: string, partId: string, state: "GREEN" | "RED") => ({ salesAccountId, partId, state })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(employeeIdFor).mockResolvedValue("emp-1")
  vi.mocked(canDo).mockResolvedValue(true)
  vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1", fullName: "Rahim" } as any)
  vi.mocked(prisma.heatmapGroup.findMany).mockResolvedValue(GROUPS as any)
  vi.mocked(prisma.salesAccount.findMany).mockResolvedValue(ACCOUNTS as any)
  vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([
    mark("acc-a", "p-mid", "GREEN"), // Alpha: Router Green
    mark("acc-b", "p-small", "RED"), mark("acc-b", "p-mid", "RED"), // Beta: Router Red
    mark("acc-c", "p-small", "RED"), // Gamma: Router half crossed, so not checked
    mark("acc-a", "p-sw", "RED"), // Alpha: Switch Red
  ] as any)
})

describe("the heatmap band", () => {
  it("counts Green, Red and not checked accounts for each product", async () => {
    const overview = await getHeatmapOverview({}, USER)
    const router = overview.products.find((p) => p.id === "prod-router")!
    expect(router).toMatchObject({ title: "Router", groupTitle: "Network", green: 1, red: 1, notChecked: 1 })
    expect(router.greenAccounts).toEqual([{ id: "acc-a", name: "Alpha Ltd" }])
    expect(router.redAccounts).toEqual([{ id: "acc-b", name: "Beta Ltd" }])
    expect(overview.products.find((p) => p.id === "prod-switch")).toMatchObject({ green: 0, red: 1, notChecked: 2 })
  })

  it("counts accounts where anything was ticked or crossed as checked", async () => {
    const overview = await getHeatmapOverview({}, USER)
    expect(overview).toMatchObject({ accounts: 3, checkedAccounts: 3, employeeName: "Rahim" })
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("acc-a", "p-mid", "GREEN")] as any)
    expect((await getHeatmapOverview({}, USER)).checkedAccounts).toBe(1)
  })

  it("does not count a mark on a part that is hidden", async () => {
    vi.mocked(prisma.salesAccountHeatmapMark.findMany).mockResolvedValue([mark("acc-a", "p-old", "GREEN")] as any)
    expect((await getHeatmapOverview({}, USER)).checkedAccounts).toBe(0)
  })

  it("asks for the caller's own active accounts by default", async () => {
    await getHeatmapOverview({}, USER)
    expect(vi.mocked(prisma.salesAccount.findMany).mock.calls[0][0]).toMatchObject({
      where: { status: "ACTIVE", ownerEmployeeId: "emp-1" },
    })
    expect(canDo).not.toHaveBeenCalled()
  })

  it("gives the whole team every active account, with the team permission", async () => {
    const overview = await getHeatmapOverview({ employeeId: "all" }, USER)
    expect(canDo).toHaveBeenCalledWith(USER, "team.dashboard")
    expect(vi.mocked(prisma.salesAccount.findMany).mock.calls[0][0]).toMatchObject({ where: { status: "ACTIVE" } })
    expect(vi.mocked(prisma.salesAccount.findMany).mock.calls[0][0]!.where).not.toHaveProperty("ownerEmployeeId")
    expect(overview.employeeName).toBe("Everyone")
  })

  it("refuses the team or somebody else without the permission, in plain words", async () => {
    vi.mocked(canDo).mockResolvedValue(false)
    await expect(getHeatmapOverview({ employeeId: "all" }, USER)).rejects.toMatchObject({
      statusCode: 403, message: "You cannot see the whole team. Ask a Sales Admin.",
    })
    await expect(getHeatmapOverview({ employeeId: OTHER_ID }, USER)).rejects.toMatchObject({
      statusCode: 403, message: "You can only see your own dashboard",
    })
  })

  it("shows somebody else's accounts when allowed", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: OTHER_ID, fullName: "Karim" } as any)
    const overview = await getHeatmapOverview({ employeeId: OTHER_ID }, USER)
    expect(overview.employeeName).toBe("Karim")
    expect(vi.mocked(prisma.salesAccount.findMany).mock.calls[0][0]).toMatchObject({ where: { ownerEmployeeId: OTHER_ID } })
  })

  it("explains a user with no employee record", async () => {
    vi.mocked(employeeIdFor).mockResolvedValue(null)
    await expect(getHeatmapOverview({}, USER)).rejects.toMatchObject({ statusCode: 400 })
  })

  it("reads no marks and counts nothing when there are no accounts", async () => {
    vi.mocked(prisma.salesAccount.findMany).mockResolvedValue([] as any)
    const overview = await getHeatmapOverview({}, USER)
    expect(prisma.salesAccountHeatmapMark.findMany).not.toHaveBeenCalled()
    expect(overview).toMatchObject({ accounts: 0, checkedAccounts: 0 })
    expect(overview.products[0]).toMatchObject({ green: 0, red: 0, notChecked: 0 })
  })
})
