import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/prisma", () => {
  const client = {
    leaveType: { findMany: vi.fn(), findUnique: vi.fn() },
    leaveRequest: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    employee: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findMany: vi.fn() },
    // Day counting reads the gazetted calendar now, so every path that
    // charges days touches this table.
    holiday: { findMany: vi.fn() },
    // Approval consults the payroll month lock. Defaulted to null in the
    // global beforeEach — without that, every existing approval test hits an
    // unmocked table.
    payrollRun: { findUnique: vi.fn() },
    // The event log. Every lifecycle change now writes one row inside the
    // same transaction as the change itself.
    event: { create: vi.fn() },
    // Approving or reverting a leave re-judges frozen punch flags for the
    // dates it covers, so those writes go through this same mocked client.
    attendance: { findMany: vi.fn(), update: vi.fn() },
    attendanceAudit: { create: vi.fn() },
    shift: { findMany: vi.fn() },
    // Hands the callback the same mocked client, so assertions written
    // against `prisma.leaveRequest.update` keep working now that the call
    // goes through a `tx`.
    $transaction: vi.fn(),
  }
  client.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(client))
  return { default: client }
})

// Earned-leave accrual is derived from the attendance day grid. These tests
// are about leave policy, not about attendance, so the grid is stubbed and
// the accrual maths is exercised directly in leave.accrual.test.ts.
vi.mock("../attendance/attendance.grid", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../attendance/attendance.grid")>()),
  buildDayGrid: vi.fn(async () => new Map()),
}))

vi.mock("../notification/notification.mailer", () => ({
  sendLeaveRequestedEmail: vi.fn(() => Promise.resolve()),
  sendLeaveDecidedEmail: vi.fn(() => Promise.resolve()),
}))
vi.mock("../notification/notification.recipients", () => ({
  recipientsForLeaveRequest: vi.fn(() => Promise.resolve(["mgr@b.com"])),
}))

import { sendLeaveDecidedEmail, sendLeaveRequestedEmail } from "../notification/notification.mailer"
import prisma from "../../config/prisma"
import { parseDateOnly } from "./leave.dates"
import {
  applyForLeave,
  approveLeaveRequest,
  cancelLeaveRequest,
  computeEntitlement,
  entitlementFor,
  getBalancesForEmployee,
  getTeamStatus,
  isUnpaidType,
  listLeaveRequests,
  rejectLeaveRequest,
  revertLeaveRequest,
} from "./leave.service"

/** Policy defaults for a plain pro-rated type, so fixtures stay readable. */
const PRO_RATED = {
  carryForwardPct: 0,
  maxConsecutive: null,
  statutory: true,
  countsHolidays: false,
  accrualBasis: "PRO_RATED" as const,
  minServiceMonths: 0,
  maxAccrual: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks drops resolved values too, so the calendar has to be
  // re-armed or every day count awaits an undefined.
  vi.mocked(prisma.holiday.findMany).mockResolvedValue([])
  // No payroll run for any month unless a test says otherwise, so the month
  // lock is open by default.
  vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(null)
  // No attendance rows to re-judge unless a test says otherwise, so the
  // punch-flag recompute is a no-op on the decision paths.
  vi.mocked(prisma.attendance.findMany).mockResolvedValue([])
})

describe("computeEntitlement", () => {
  it("gives the full quota to someone who joined in an earlier year", () => {
    expect(computeEntitlement(18, parseDateOnly("2023-04-01"), 2026)).toBe(18)
  })

  it("gives nothing for a year before the employee joined", () => {
    expect(computeEntitlement(18, parseDateOnly("2027-01-01"), 2026)).toBe(0)
  })

  it("pro-rates the joining year by months remaining", () => {
    // Joined November (month index 10) -> 2 of 12 months -> round(18 * 2/12) = 3
    expect(computeEntitlement(18, parseDateOnly("2026-11-10"), 2026)).toBe(3)
    // Joined January -> full 12 months -> full quota
    expect(computeEntitlement(18, parseDateOnly("2026-01-05"), 2026)).toBe(18)
    // Joined July (index 6) -> 6 of 12 -> 9
    expect(computeEntitlement(18, parseDateOnly("2026-07-01"), 2026)).toBe(9)
  })

  it("never returns a negative entitlement", () => {
    expect(computeEntitlement(0, parseDateOnly("2026-11-10"), 2026)).toBe(0)
  })
})

describe("isUnpaidType", () => {
  it("is true only for a zero-quota unpaid type", () => {
    expect(isUnpaidType({ isPaid: false, annualQuota: 0 })).toBe(true)
    expect(isUnpaidType({ isPaid: true, annualQuota: 0 })).toBe(false)
    expect(isUnpaidType({ isPaid: false, annualQuota: 5 })).toBe(false)
  })
})

describe("entitlementFor", () => {
  const employee = { joiningDate: parseDateOnly("2026-11-10") }

  it("pro-rates the joining year for a PRO_RATED type", () => {
    expect(
      entitlementFor({ ...PRO_RATED, annualQuota: 14, countsHolidays: false }, employee, 2026, null)
    ).toBe(2)
  })

  it("never pro-rates a PER_EVENT type", () => {
    // §46 maternity is not smaller because the employee joined in November.
    expect(
      entitlementFor(
        { ...PRO_RATED, accrualBasis: "PER_EVENT", annualQuota: 120 },
        employee,
        2026,
        null
      )
    ).toBe(120)
  })

  it("takes an EARNED type's entitlement from the accrual, not the quota", () => {
    expect(
      entitlementFor(
        { ...PRO_RATED, accrualBasis: "EARNED", annualQuota: 0 },
        employee,
        2026,
        { days: 7, daysWorked: 130, windowStart: "", windowEnd: "", untrackedDays: 0, eligible: true }
      )
    ).toBe(7)
  })

  it("gives a NONE type nothing, whatever its quota says", () => {
    expect(
      entitlementFor({ ...PRO_RATED, accrualBasis: "NONE", annualQuota: 99 }, employee, 2026, null)
    ).toBe(0)
  })
})

describe("getBalancesForEmployee", () => {
  const employee = {
    id: "emp-1",
    employmentType: "FULL_TIME",
    joiningDate: parseDateOnly("2020-01-01"),
    employmentStatus: "ACTIVE",
    shiftId: null,
  }

  const casual = {
    id: "lt-1",
    code: "CASUAL",
    name: "Casual",
    isPaid: true,
    annualQuota: 10,
    eligibleFor: ["FULL_TIME"],
    ...PRO_RATED,
  }

  it("subtracts approved and pending days from the pro-rated entitlement", async () => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([casual] as any)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        leaveTypeId: "lt-1",
        status: "APPROVED",
        startDate: parseDateOnly("2026-08-10"),
        endDate: parseDateOnly("2026-08-12"),
      },
      {
        leaveTypeId: "lt-1",
        status: "PENDING",
        startDate: parseDateOnly("2026-09-07"),
        endDate: parseDateOnly("2026-09-08"),
      },
    ] as any)

    const result = await getBalancesForEmployee(employee as any, 2026)

    expect(result).toEqual([
      {
        leaveTypeId: "lt-1",
        code: "CASUAL",
        name: "Casual",
        isPaid: true,
        annualQuota: 10,
        entitlement: 10,
        used: 3,
        pending: 2,
        balance: 5,
        accrual: null,
      },
    ])
  })

  it("does not charge a gazetted holiday to a type that excludes them", async () => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([casual] as any)
    // Wed 2026-08-05 is July Uprising Day, inside a Mon-Thu range.
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([
      { date: parseDateOnly("2026-08-05"), type: "GENERAL" },
    ] as any)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        leaveTypeId: "lt-1",
        status: "APPROVED",
        startDate: parseDateOnly("2026-08-03"),
        endDate: parseDateOnly("2026-08-06"),
      },
    ] as any)

    const result = await getBalancesForEmployee(employee as any, 2026)

    expect(result[0].used).toBe(3)
  })

  it("charges the same holiday to an earned-leave request (§117)", async () => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([
      { ...casual, code: "EARNED", name: "Earned", countsHolidays: true },
    ] as any)
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([
      { date: parseDateOnly("2026-08-05"), type: "GENERAL" },
    ] as any)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        leaveTypeId: "lt-1",
        status: "APPROVED",
        startDate: parseDateOnly("2026-08-03"),
        endDate: parseDateOnly("2026-08-06"),
      },
    ] as any)

    const result = await getBalancesForEmployee(employee as any, 2026)

    expect(result[0].used).toBe(4)
  })

  it("reports zero earned leave, with the reason, before a year of service", async () => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([
      {
        ...casual,
        code: "EARNED",
        name: "Earned",
        annualQuota: 0,
        countsHolidays: true,
        accrualBasis: "EARNED",
        minServiceMonths: 12,
        maxAccrual: 60,
      },
    ] as any)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])

    const result = await getBalancesForEmployee(
      { ...employee, joiningDate: parseDateOnly("2026-06-01") } as any,
      2026
    )

    expect(result[0].entitlement).toBe(0)
    expect(result[0].accrual).toMatchObject({ eligible: false, minServiceMonths: 12 })
  })

  it("only returns types the employee's employment type is eligible for", async () => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([
      casual,
      { ...casual, id: "lt-2", code: "INTERN_ONLY", name: "Intern Only", eligibleFor: ["INTERN"] },
    ] as any)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])

    const result = await getBalancesForEmployee(employee as any, 2026)

    expect(result).toHaveLength(1)
    expect(result[0].leaveTypeId).toBe("lt-1")
  })

  it("ignores rejected and cancelled requests", async () => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([casual] as any)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([] as any)

    const result = await getBalancesForEmployee(employee as any, 2026)

    // The query itself must exclude them, so the service never sees them.
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ["PENDING", "APPROVED"] } }),
      })
    )
    expect(result[0].balance).toBe(10)
  })
})

describe("listLeaveRequests scoping", () => {
  beforeEach(() => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
  })

  it("scopes an EMPLOYEE to their own requests", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "emp-1" } as any)
    await listLeaveRequests({ sub: "user-1", role: "EMPLOYEE" } as any)
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: "emp-1" } })
    )
  })

  it("scopes a REPORTING_MANAGER to themselves plus their direct reports", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "mgr-1" } as any)
    await listLeaveRequests({ sub: "user-2", role: "REPORTING_MANAGER" } as any)
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ employeeId: "mgr-1" }, { employee: { reportingManagerId: "mgr-1" } }] },
      })
    )
  })

  it("does not scope HR_ADMIN at all", async () => {
    await listLeaveRequests({ sub: "user-3", role: "HR_ADMIN" } as any)
    expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    )
  })
})

describe("getTeamStatus", () => {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  function report(over: Record<string, unknown> = {}) {
    return {
      id: "r1",
      fullName: "Report One",
      employeeCode: "BS-EMP-00001",
      designation: "Analyst",
      employmentStatus: "ACTIVE",
      leaveRequests: [],
      ...over,
    }
  }

  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({ id: "mgr-1" } as any)
  })

  it("reports a resigned or terminated employee as LEFT, even if on approved leave", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      report({
        employmentStatus: "RESIGNED",
        leaveRequests: [
          {
            status: "APPROVED",
            startDate: parseDateOnly(iso(today)),
            endDate: parseDateOnly(iso(today)),
            leaveType: { name: "Annual" },
          },
        ],
      }),
    ] as any)
    const result = await getTeamStatus("user-2")
    expect(result[0].status).toBe("LEFT")
  })

  it("reports ON_LEAVE when an approved request covers today", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([
      report({
        leaveRequests: [
          {
            status: "APPROVED",
            startDate: parseDateOnly(iso(today)),
            endDate: parseDateOnly(iso(today)),
            leaveType: { name: "Annual" },
          },
        ],
      }),
    ] as any)
    const result = await getTeamStatus("user-2")
    expect(result[0].status).toBe("ON_LEAVE")
    expect(result[0].currentLeave?.leaveTypeName).toBe("Annual")
  })

  it("reports ACTIVE with no current leave when nothing covers today", async () => {
    vi.mocked(prisma.employee.findMany).mockResolvedValue([report()] as any)
    const result = await getTeamStatus("user-2")
    expect(result[0].status).toBe("ACTIVE")
    expect(result[0].currentLeave).toBeNull()
  })

  it("only counts approved leave covering today, so pending and future leave never set a status", async () => {
    // This is enforced in the query, not in the mapping — a PENDING request or
    // a future-dated approval is never returned, so it can never read as
    // ON_LEAVE. Applying for leave says nothing about where someone is today.
    vi.mocked(prisma.employee.findMany).mockResolvedValue([report()] as any)
    await getTeamStatus("user-2")

    const args = vi.mocked(prisma.employee.findMany).mock.calls[0][0] as any
    expect(args.select.leaveRequests.where).toEqual({
      status: "APPROVED",
      startDate: { lte: expect.any(Date) },
      endDate: { gte: expect.any(Date) },
    })
  })
})

describe("applyForLeave validation", () => {
  const employee = {
    id: "emp-1",
    employmentType: "FULL_TIME",
    joiningDate: parseDateOnly("2020-01-01"),
    employmentStatus: "ACTIVE",
    shiftId: null,
  }
  const casual = {
    id: "lt-1",
    code: "CASUAL",
    name: "Casual",
    isPaid: true,
    annualQuota: 10,
    allowsBackdating: false,
    eligibleFor: ["FULL_TIME"],
    ...PRO_RATED,
  }

  function futureDate(offsetDays: number) {
    const d = new Date(Date.now() + offsetDays * 86_400_000)
    return d.toISOString().slice(0, 10)
  }

  /**
   * The next Friday, never today's.
   *
   * Two tests below need a weekly off to fall inside the range. Written out in
   * full, the date passes until the day it slips into the past and the service
   * rejects it for being backdated instead — which is exactly how it broke.
   */
  function nextFriday() {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7 || 7))
    return d.toISOString().slice(0, 10)
  }

  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any)
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue(casual as any)
    vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([casual] as any)
  })

  it("rejects an end date before the start date", async () => {
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(10),
        endDate: futureDate(5),
      })
    ).rejects.toThrow(/end date/i)
  })

  it("rejects a range spanning two calendar years", async () => {
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: "2026-12-28",
        endDate: "2027-01-05",
      })
    ).rejects.toThrow(/same year|two|split/i)
  })

  it("rejects a backdated request for a type that disallows it", async () => {
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(-3),
        endDate: futureDate(-2),
      })
    ).rejects.toThrow(/past|backdat/i)
  })

  it("allows a backdated request for a type that permits it", async () => {
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      allowsBackdating: true,
    } as any)
    vi.mocked(prisma.leaveRequest.create).mockResolvedValue({
      id: "req-1",
      employee: { id: "emp-1", fullName: "A", employeeCode: "BS-EMP-00001" },
      leaveType: { id: "lt-1", name: "Annual", isPaid: true },
      startDate: parseDateOnly(futureDate(-3)),
      endDate: parseDateOnly(futureDate(-2)),
      reason: null,
      status: "PENDING",
      createdAt: new Date(),
    } as any)
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(-3),
        endDate: futureDate(-2),
      })
    ).resolves.toBeDefined()
  })

  it("rejects a backdated request beyond the 30-day window", async () => {
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      allowsBackdating: true,
    } as any)
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(-45),
        endDate: futureDate(-44),
      })
    ).rejects.toThrow(/30 days/i)
  })

  it("rejects a range with nothing chargeable in it", async () => {
    // A single Friday: the weekly off, so casual leave has nothing to charge.
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: nextFriday(),
        endDate: nextFriday(),
      })
    ).rejects.toThrow(/nothing to charge/i)
  })

  it("accepts that same Friday for a type that counts holidays as leave", async () => {
    // §117: an earned-leave range is charged in calendar days, so a Friday
    // inside it is a day of leave rather than a day that vanishes.
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      code: "EARNED",
      name: "Earned",
      countsHolidays: true,
      allowsBackdating: true,
    } as any)
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([
      { ...casual, code: "EARNED", name: "Earned", countsHolidays: true },
    ] as any)
    vi.mocked(prisma.leaveRequest.create).mockResolvedValue({
      id: "req-1",
      employee: { id: "emp-1", fullName: "A", employeeCode: "BS-EMP-00001" },
      leaveType: { id: "lt-1", code: "EARNED", name: "Earned", isPaid: true, countsHolidays: true },
      startDate: parseDateOnly(futureDate(5)),
      endDate: parseDateOnly(futureDate(5)),
      reason: null,
      status: "PENDING",
      createdAt: new Date(),
    } as any)

    const created = await applyForLeave("user-1", {
      leaveTypeId: "lt-1",
      startDate: nextFriday(),
      endDate: nextFriday(),
    })
    expect(created.days).toBe(1)
  })

  it("emails whoever can act on the request once it is filed", async () => {
    // A Monday, so the range is not entirely weekly off and something is
    // actually charged — the same reason the decision fixtures pin a date.
    const monday = (() => {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() + ((1 - d.getUTCDay() + 7) % 7 || 7))
      return d.toISOString().slice(0, 10)
    })()
    vi.mocked(prisma.leaveRequest.create).mockResolvedValue({
      id: "req-1",
      employee: { id: "emp-1", fullName: "A Person", employeeCode: "BS-EMP-00001" },
      leaveType: { id: "lt-1", code: "CASUAL", name: "Casual", isPaid: true },
      startDate: parseDateOnly(monday),
      endDate: parseDateOnly(monday),
      reason: null,
      status: "PENDING",
      createdAt: new Date(),
    } as any)

    await applyForLeave("user-1", {
      leaveTypeId: "lt-1",
      startDate: monday,
      endDate: monday,
    })

    expect(sendLeaveRequestedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "mgr@b.com", requestId: "req-1", employeeName: "A Person" })
    )
  })

  it("refuses a type the employee has not served long enough for", async () => {
    // §117 earned leave: one year of continuous service, measured at the
    // leave start rather than at filing.
    vi.mocked(prisma.employee.findUnique).mockResolvedValue({
      ...employee,
      joiningDate: parseDateOnly(futureDate(-30)),
    } as any)
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      code: "EARNED",
      name: "Earned",
      minServiceMonths: 12,
    } as any)

    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(5),
        endDate: futureDate(7),
      })
    ).rejects.toThrow(/continuous service/i)
  })

  it("rejects a request overlapping an existing pending or approved one", async () => {
    vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValue({ id: "existing" } as any)
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(5),
        endDate: futureDate(7),
      })
    ).rejects.toThrow(/overlap/i)
  })

  it("rejects a leave type the employment type is not eligible for", async () => {
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      eligibleFor: ["INTERN"],
    } as any)
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(5),
        endDate: futureDate(7),
      })
    ).rejects.toThrow(/eligible/i)
  })

  it("measures maxConsecutive against the calendar span, not charged days", async () => {
    // Any seven consecutive days span 7 calendar days and contain exactly one
    // Friday, so this is always 6 charged days against a limit of 6 — whatever
    // weekday it is run on. The dates were once written out in full, which made
    // the test pass until the day they fell into the past.
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      maxConsecutive: 6,
    } as any)
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(1),
        endDate: futureDate(7),
      })
    ).rejects.toThrow(/consecutive/i)
  })

  it("rejects when approved + pending + new would exceed the entitlement", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        leaveTypeId: "lt-1",
        status: "APPROVED",
        startDate: parseDateOnly("2026-03-02"),
        endDate: parseDateOnly("2026-03-20"),
      },
    ] as any)
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(5),
        endDate: futureDate(9),
      })
    ).rejects.toThrow(/balance|remain|Leave Without Pay/i)
  })

  it("skips the balance check for an unpaid, zero-quota type", async () => {
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      name: "Leave Without Pay",
      isPaid: false,
      annualQuota: 0,
    } as any)
    vi.mocked(prisma.leaveRequest.create).mockResolvedValue({
      id: "req-1",
      employee: { id: "emp-1", fullName: "A", employeeCode: "BS-EMP-00001" },
      leaveType: { id: "lt-1", name: "Leave Without Pay", isPaid: false },
      startDate: parseDateOnly(futureDate(5)),
      endDate: parseDateOnly(futureDate(9)),
      reason: null,
      status: "PENDING",
      createdAt: new Date(),
    } as any)
    await expect(
      applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(5),
        endDate: futureDate(9),
      })
    ).resolves.toBeDefined()
  })
})

describe("leave decisions", () => {
  const casual = {
    id: "lt-1",
    code: "CASUAL",
    name: "Annual",
    isPaid: true,
    annualQuota: 18,
    eligibleFor: ["FULL_TIME"],
  }
  const employee = {
    id: "emp-1",
    fullName: "Ayesha Rahman",
    employmentType: "FULL_TIME",
    joiningDate: parseDateOnly("2020-01-01"),
    user: { email: "employee@b.com" },
  }

  function futureDate(offsetDays: number) {
    return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
  }

  function pendingRequest(over: Record<string, unknown> = {}) {
    return {
      id: "req-1",
      employeeId: "emp-1",
      leaveTypeId: "lt-1",
      status: "PENDING",
      // Fixed, not `futureDate(...)`: a relative window silently straddles the
      // Friday weekly-off on some run dates, charging 2 days instead of 3 and
      // failing an assertion that is about event payloads, not day counting.
      // Mon 2026-09-07 to Wed 2026-09-09 contains no weekly off.
      startDate: parseDateOnly("2026-09-07"),
      endDate: parseDateOnly("2026-09-09"),
      reason: null,
      approvedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: new Date(),
      employee,
      leaveType: casual,
      ...over,
    }
  }

  beforeEach(() => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([casual] as any)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
    vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.leaveRequest.update).mockResolvedValue({ id: "req-1" } as any)
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
  })

  it("404s when the request does not exist", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(null)
    await expect(approveLeaveRequest("req-1", "hr-1")).rejects.toMatchObject({ statusCode: 404 })
  })

  it("409s when approving something that is not pending", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      pendingRequest({ status: "APPROVED" }) as any
    )
    await expect(approveLeaveRequest("req-1", "hr-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("approves a pending request and stamps the decision", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
    await approveLeaveRequest("req-1", "hr-1")
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "req-1" },
        data: expect.objectContaining({ status: "APPROVED", approvedBy: "hr-1" }),
      })
    )
  })

  it("emails the employee when a leave request is approved", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)

    await approveLeaveRequest("req-1", "hr-1")

    expect(sendLeaveDecidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "employee@b.com", approved: true })
    )
  })

  it("emails the employee the reason when a leave request is rejected", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)

    await rejectLeaveRequest("req-1", "hr-1", "Two people already off that week")

    expect(sendLeaveDecidedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "employee@b.com",
        approved: false,
        reason: "Two people already off that week",
      })
    )
  })

  it("409s at approval when the balance has since been consumed", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
    // 22 charged days already approved this year -> nothing left of an 18-day quota
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        leaveTypeId: "lt-1",
        status: "APPROVED",
        startDate: parseDateOnly("2026-03-02"),
        endDate: parseDateOnly("2026-03-27"),
      },
    ] as any)
    await expect(approveLeaveRequest("req-1", "hr-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("409s at approval when another approved request now overlaps", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
    vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValue({ id: "other" } as any)
    await expect(approveLeaveRequest("req-1", "hr-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  // Approving a backdated sick day retroactively flips a derived attendance
  // status from ABSENT to ON_LEAVE, moving that month's payable days. If the
  // month is already paid, the money is already wrong.
  it("409s when the leave starts in a month whose payroll is approved", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      pendingRequest({
        startDate: parseDateOnly("2026-07-06"),
        endDate: parseDateOnly("2026-07-08"),
      }) as any
    )
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ status: "APPROVED" } as any)
    await expect(approveLeaveRequest("req-1", "hr-1")).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled()
  })

  it("approves normally when the month's run is still a draft", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue({ status: "DRAFT" } as any)
    await approveLeaveRequest("req-1", "hr-1")
    expect(prisma.leaveRequest.update).toHaveBeenCalled()
  })

  it("409s for a range spanning an open month and a closed one", async () => {
    // The start month is open, so checking only startDate would let this
    // through — and it changes August's payable days too.
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      pendingRequest({
        startDate: parseDateOnly("2026-07-30"),
        endDate: parseDateOnly("2026-08-03"),
      }) as any
    )
    vi.mocked(prisma.payrollRun.findUnique).mockImplementation((async (args: any) =>
      args.where.month_year.month === 8 ? { status: "DISBURSED" } : null) as any)
    await expect(approveLeaveRequest("req-1", "hr-1")).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.leaveRequest.update).not.toHaveBeenCalled()
  })

  it("requires a note to reject and records it", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
    await rejectLeaveRequest("req-1", "hr-1", "Team is short-staffed that week")
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "REJECTED",
          decisionNote: "Team is short-staffed that week",
        }),
      })
    )
  })

  it("lets the requester cancel their own pending request", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any)
    await cancelLeaveRequest("req-1", "user-1")
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) })
    )
  })

  it("403s when cancelling someone else's request", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      pendingRequest({ employeeId: "emp-2" }) as any
    )
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any)
    await expect(cancelLeaveRequest("req-1", "user-1")).rejects.toMatchObject({ statusCode: 403 })
  })

  it("lets the requester cancel approved leave that has not started", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      pendingRequest({ status: "APPROVED" }) as any
    )
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any)
    await expect(cancelLeaveRequest("req-1", "user-1")).resolves.toBeDefined()
  })

  it("409s when cancelling leave that has already started", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      pendingRequest({
        status: "APPROVED",
        startDate: parseDateOnly(futureDate(-2)),
        endDate: parseDateOnly(futureDate(2)),
      }) as any
    )
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any)
    await expect(cancelLeaveRequest("req-1", "user-1")).rejects.toMatchObject({ statusCode: 409 })
  })

  it("lets HR revert a future-dated approval", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      pendingRequest({ status: "APPROVED" }) as any
    )
    await revertLeaveRequest("req-1", "hr-1", "Approved by mistake")
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCELLED", decisionNote: "Approved by mistake" }),
      })
    )
  })

  it("409s when reverting a request that is not approved", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
    await expect(revertLeaveRequest("req-1", "hr-1", "nope")).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  describe("events", () => {
    /** The single `create` argument the emit produced. */
    const emitted = () => vi.mocked(prisma.event.create).mock.calls[0][0].data as any

    beforeEach(() => {
      vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any)
    })

    it("emits leave.requested when a request is filed", async () => {
      vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
        ...casual,
        ...PRO_RATED,
      } as any)
      vi.mocked(prisma.leaveRequest.create).mockResolvedValue({
        id: "req-9",
        startDate: parseDateOnly(futureDate(10)),
        endDate: parseDateOnly(futureDate(12)),
        reason: null,
        status: "PENDING",
        createdAt: new Date(),
        employee: { id: "emp-1", fullName: "Ayesha Rahman", employeeCode: "BS-EMP-1" },
        leaveType: casual,
      } as any)

      await applyForLeave("user-1", {
        leaveTypeId: "lt-1",
        startDate: futureDate(10),
        endDate: futureDate(12),
      } as any)

      expect(emitted()).toMatchObject({
        type: "leave.requested",
        severity: "INFO",
        entity: "LEAVE_REQUEST",
        entityId: "req-9",
        subjectEmployeeId: "emp-1",
        targetRoles: ["HR_ADMIN"],
        actorUserId: "user-1",
      })
    })

    it("emits leave.approved as SUCCESS, with the strings frozen", async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
      await approveLeaveRequest("req-1", "hr-1")

      const event = emitted()
      expect(event.type).toBe("leave.approved")
      expect(event.severity).toBe("SUCCESS")
      // Frozen at emit, so the row still reads correctly after the type is
      // renamed or the request is deleted.
      expect(event.title).toBe("Annual leave approved")
      // The name is in `meta` because the same row is read by the employee,
      // their manager and HR.
      expect(event.meta).toContain("Ayesha Rahman")
      // The facts behind the strings, so a later email template does not
      // have to parse `title` back apart.
      expect(event.payload).toMatchObject({ leaveTypeCode: "CASUAL", status: "APPROVED", days: 3 })
    })

    it("emits leave.rejected as WARNING, not ERROR", async () => {
      // A rejection is a decision, not a fault.
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
      await rejectLeaveRequest("req-1", "hr-1", "Not enough cover")

      expect(emitted()).toMatchObject({ type: "leave.rejected", severity: "WARNING" })
    })

    it("emits leave.cancelled when the requester withdraws", async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
      await cancelLeaveRequest("req-1", "user-1")

      expect(emitted()).toMatchObject({ type: "leave.cancelled", actorUserId: "user-1" })
    })

    it("writes the event inside the same transaction as the update", async () => {
      // Not two calls that happen to both succeed: an event surviving a
      // rolled-back update would tell a manager to review something that
      // does not exist.
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
      await approveLeaveRequest("req-1", "hr-1")

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.leaveRequest.update).toHaveBeenCalled()
      expect(prisma.event.create).toHaveBeenCalled()
    })

    it("writes no event when the transaction rolls back", async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
      vi.mocked(prisma.leaveRequest.update).mockRejectedValueOnce(new Error("db down"))

      await expect(approveLeaveRequest("req-1", "hr-1")).rejects.toThrow("db down")
      expect(prisma.event.create).not.toHaveBeenCalled()
    })

    it("emits with a null manager for a subject who has none", async () => {
      // The CEO filing leave is not an error.
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
      vi.mocked(prisma.employee.findUnique).mockResolvedValue({
        reportingManagerId: null,
      } as any)

      await approveLeaveRequest("req-1", "hr-1")
      expect(emitted().managerEmployeeId).toBeNull()
    })

    it("freezes the manager resolved at emit onto the row", async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(pendingRequest() as any)
      vi.mocked(prisma.employee.findUnique).mockResolvedValue({
        reportingManagerId: "emp-mgr",
      } as any)

      await approveLeaveRequest("req-1", "hr-1")
      expect(emitted().managerEmployeeId).toBe("emp-mgr")
    })

    it("emits nothing when a request is reverted", async () => {
      // A deliberate gap: "your approved leave was un-approved" needs a
      // wording decision, not a mechanical mapping of the other four.
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
        pendingRequest({ status: "APPROVED" }) as any
      )
      await revertLeaveRequest("req-1", "hr-1", "Approved by mistake")
      expect(prisma.event.create).not.toHaveBeenCalled()
    })

    it("does not put the word leave in twice for Leave Without Pay", async () => {
      vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
        pendingRequest({
          leaveType: { ...casual, name: "Leave Without Pay", isPaid: false },
        }) as any
      )
      await approveLeaveRequest("req-1", "hr-1")
      expect(emitted().title).toBe("Leave Without Pay approved")
    })
  })
})

describe("half-day leave", () => {
  const PRO_RATED_HALF = {
    carryForwardPct: 0,
    maxConsecutive: null,
    statutory: true,
    countsHolidays: false,
    accrualBasis: "PRO_RATED" as const,
    minServiceMonths: 0,
    maxAccrual: null,
    allowsHalfDay: true,
  }

  const employee = {
    id: "emp-1",
    fullName: "Ayesha Rahman",
    employmentType: "FULL_TIME",
    joiningDate: parseDateOnly("2020-01-01"),
    employmentStatus: "ACTIVE",
    shiftId: null,
  }

  const casual = {
    id: "lt-1",
    code: "CASUAL",
    name: "Casual",
    isPaid: true,
    annualQuota: 10,
    allowsBackdating: false,
    eligibleFor: ["FULL_TIME"],
    ...PRO_RATED_HALF,
  }

  // Mon 2026-09-07: a working day, in the future, no weekly off.
  const DATE = "2026-09-07"

  const halfDayBody = {
    leaveTypeId: "lt-1",
    startDate: DATE,
    endDate: DATE,
    startSession: "FIRST_HALF" as const,
    endSession: "FIRST_HALF" as const,
  }

  const createdRow = (over: Record<string, unknown> = {}) => ({
    id: "req-h",
    employeeId: "emp-1",
    leaveTypeId: "lt-1",
    startDate: parseDateOnly(DATE),
    endDate: parseDateOnly(DATE),
    startSession: "FIRST_HALF",
    endSession: "FIRST_HALF",
    reason: null,
    status: "PENDING",
    createdAt: new Date(),
    employee,
    leaveType: casual,
    ...over,
  })

  beforeEach(() => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any)
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue(casual as any)
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([casual] as any)
    vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
    vi.mocked(prisma.holiday.findMany).mockResolvedValue([])
    vi.mocked(prisma.payrollRun.findUnique).mockResolvedValue(null as any)
  })

  it("charges 0.5 when applying for a morning half", async () => {
    vi.mocked(prisma.leaveRequest.create).mockResolvedValue(createdRow() as any)

    const result = await applyForLeave("user-1", halfDayBody as any)
    expect(result.days).toBe(0.5)
    expect(result.startSession).toBe("FIRST_HALF")
    expect(result.endSession).toBe("FIRST_HALF")
  })

  it("persists the sessions it was given", async () => {
    vi.mocked(prisma.leaveRequest.create).mockResolvedValue(
      createdRow({ startSession: "SECOND_HALF", endSession: "SECOND_HALF" }) as any
    )

    await applyForLeave("user-1", {
      ...halfDayBody,
      startSession: "SECOND_HALF",
      endSession: "SECOND_HALF",
    } as any)

    expect(vi.mocked(prisma.leaveRequest.create).mock.calls[0][0]).toMatchObject({
      data: { startSession: "SECOND_HALF", endSession: "SECOND_HALF" },
    })
  })

  it("refuses a half day on a type that does not allow one", async () => {
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      name: "Maternity",
      allowsHalfDay: false,
    } as any)

    await expect(applyForLeave("user-1", halfDayBody as any)).rejects.toThrow(
      /Maternity leave cannot be taken as a half day/
    )
  })

  it("allows a whole-day request on a type that forbids halves", async () => {
    vi.mocked(prisma.leaveType.findUnique).mockResolvedValue({
      ...casual,
      name: "Maternity",
      allowsHalfDay: false,
    } as any)
    vi.mocked(prisma.leaveRequest.create).mockResolvedValue(
      createdRow({ startSession: "FIRST_HALF", endSession: "SECOND_HALF" }) as any
    )

    const result = await applyForLeave("user-1", {
      leaveTypeId: "lt-1",
      startDate: DATE,
      endDate: DATE,
      startSession: "FIRST_HALF",
      endSession: "SECOND_HALF",
    } as any)
    expect(result.days).toBe(1)
  })

  it("charges 0.5 at approval, not a whole day", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      createdRow({ approvedBy: null, decidedAt: null, decisionNote: null }) as any
    )

    const result = await approveLeaveRequest("req-h", "hr-1")
    expect(result.days).toBe(0.5)
  })

  it("counts a half day as 0.5 against the balance", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        leaveTypeId: "lt-1",
        status: "APPROVED",
        startDate: parseDateOnly(DATE),
        endDate: parseDateOnly(DATE),
        startSession: "FIRST_HALF",
        endSession: "FIRST_HALF",
      },
    ] as any)

    const balances = await getBalancesForEmployee(employee as any, 2026)
    expect(balances[0].used).toBe(0.5)
  })

  it("still charges whole days for a request with the default sessions", async () => {
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([
      {
        leaveTypeId: "lt-1",
        status: "APPROVED",
        startDate: parseDateOnly("2026-09-07"),
        endDate: parseDateOnly("2026-09-09"),
        startSession: "FIRST_HALF",
        endSession: "SECOND_HALF",
      },
    ] as any)

    const balances = await getBalancesForEmployee(employee as any, 2026)
    expect(balances[0].used).toBe(3)
  })
})

describe("punch-flag recompute on leave decisions", () => {
  const employee = {
    id: "emp-1",
    fullName: "Ayesha Rahman",
    employmentType: "FULL_TIME",
    joiningDate: parseDateOnly("2020-01-01"),
    employmentStatus: "ACTIVE",
    shiftId: null,
  }

  const casual = {
    id: "lt-1",
    code: "CASUAL",
    name: "Casual",
    isPaid: true,
    annualQuota: 10,
    eligibleFor: ["FULL_TIME"],
    carryForwardPct: 0,
    maxConsecutive: null,
    statutory: true,
    countsHolidays: false,
    accrualBasis: "PRO_RATED" as const,
    minServiceMonths: 0,
    maxAccrual: null,
    allowsHalfDay: true,
  }

  const request = (over: Record<string, unknown> = {}) => ({
    id: "req-1",
    employeeId: "emp-1",
    leaveTypeId: "lt-1",
    status: "PENDING",
    startDate: parseDateOnly("2026-09-07"),
    endDate: parseDateOnly("2026-09-07"),
    startSession: "FIRST_HALF",
    endSession: "FIRST_HALF",
    reason: null,
    approvedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: new Date(),
    employee,
    leaveType: casual,
    ...over,
  })

  beforeEach(() => {
    vi.mocked(prisma.leaveType.findMany).mockResolvedValue([casual] as any)
    vi.mocked(prisma.leaveRequest.findMany).mockResolvedValue([])
    vi.mocked(prisma.leaveRequest.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(employee as any)
  })

  it("re-judges punch flags for the dates an approval covers", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(request() as any)

    await approveLeaveRequest("req-1", "hr-1")

    expect(prisma.attendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employeeId: "emp-1",
          date: { gte: parseDateOnly("2026-09-07"), lte: parseDateOnly("2026-09-07") },
        }),
      })
    )
  })

  it("does not re-judge anything on a rejection", async () => {
    // A rejected request never made the day a half-day, so no flag was ever
    // relaxed on its account and there is nothing to undo.
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(request() as any)

    await rejectLeaveRequest("req-1", "hr-1", "Not this week")

    expect(prisma.attendance.findMany).not.toHaveBeenCalled()
  })

  it("re-judges on revert, where a relaxed flag may already be stored", async () => {
    vi.mocked(prisma.leaveRequest.findUnique).mockResolvedValue(
      request({ status: "APPROVED" }) as any
    )

    await revertLeaveRequest("req-1", "hr-1", "Approved in error")

    expect(prisma.attendance.findMany).toHaveBeenCalled()
  })
})

import { getBalancesFor } from "./leave.service"

function viewer(role: any, sub: string) {
  return { sub, role, email: "v@b.com", mustChangePassword: false, salesRole: null }
}

describe("getBalancesFor", () => {
  const subject = { id: "emp-1", userId: "u-1", reportingManagerId: "emp-mgr" }

  it("404s an unknown employee", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(null)
    await expect(getBalancesFor(viewer("HR_ADMIN", "u-hr"), "nope")).rejects.toThrowError(
      "Employee not found"
    )
  })

  it("allows HR", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(subject as any)
    await expect(getBalancesFor(viewer("HR_ADMIN", "u-hr"), "emp-1")).resolves.toBeDefined()
  })

  it("allows the subject's OWN manager", async () => {
    vi.mocked(prisma.employee.findUnique)
      .mockResolvedValueOnce(subject as any)
      .mockResolvedValueOnce({ id: "emp-mgr" } as any)
    await expect(
      getBalancesFor(viewer("REPORTING_MANAGER", "u-mgr"), "emp-1")
    ).resolves.toBeDefined()
  })

  it("refuses a DIFFERENT manager", async () => {
    // A manager is not a manager of everybody.
    vi.mocked(prisma.employee.findUnique)
      .mockResolvedValueOnce(subject as any)
      .mockResolvedValueOnce({ id: "emp-other" } as any)
    await expect(
      getBalancesFor(viewer("REPORTING_MANAGER", "u-mgr"), "emp-1")
    ).rejects.toThrowError("You do not have access to this employee's leave balances")
  })

  it("refuses an unrelated employee", async () => {
    vi.mocked(prisma.employee.findUnique)
      .mockResolvedValueOnce(subject as any)
      .mockResolvedValueOnce({ id: "emp-x" } as any)
    await expect(getBalancesFor(viewer("EMPLOYEE", "u-x"), "emp-1")).rejects.toThrowError(
      "You do not have access"
    )
  })

  it("refuses Finance", async () => {
    vi.mocked(prisma.employee.findUnique).mockResolvedValue(subject as any)
    await expect(getBalancesFor(viewer("FINANCE_OFFICER", "u-f"), "emp-1")).rejects.toThrowError(
      "You do not have access"
    )
  })
})
