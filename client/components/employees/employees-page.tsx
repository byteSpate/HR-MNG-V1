"use client"

import { useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiCheckLine,
  RiFileCopyLine,
  RiFilterOffLine,
  RiMoneyDollarCircleLine,
} from "@remixicon/react"

import { createStaffAccount, listEmployees, setSalaryStructure } from "@/lib/api/employees"
import { listDepartments } from "@/lib/api/departments"
import { listSalaryStructures } from "@/lib/api/payroll"
import { listShifts } from "@/lib/api/shifts"
import { SalaryStructureDialog } from "@/components/employees/salary-structure-dialog"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { toDateString } from "@/lib/utils"
import type {
  CreateStaffAccountInput,
  CreateStaffAccountResult,
  Department,
  EmployeeView,
  EmploymentStatus,
} from "@/lib/api/types"
import { ALL, FilterBar, FilterSelect } from "@/components/dashboard/filter-bar"
import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import { DialogActions, Field, FormError, PanelTable, RowActions } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import type { TableCell, Tone } from "@/components/dashboard/types"

const STATUS_TONE: Record<EmploymentStatus, Tone> = {
  ACTIVE: "green",
  ON_LEAVE: "yellow",
  RESIGNED: "red",
  TERMINATED: "red",
}

const STATUS_LABEL: Record<EmploymentStatus, string> = {
  ACTIVE: "Active",
  ON_LEAVE: "On leave",
  RESIGNED: "Resigned",
  TERMINATED: "Terminated",
}

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as EmploymentStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}))

/**
 * What a cell says when the viewer's tier does not include that group.
 *
 * `EmployeeView`'s groups are optional because the server projects different
 * fields per viewer, so `employment` and `payroll` can genuinely be absent.
 * This used to render a dash, which reads as "this employee has no joining
 * date" rather than "you are not shown it".
 */
const WITHHELD = "Not shown"

function formatJoiningDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

function toRows(
  employees: EmployeeView[],
  roleSegment: string,
  onAssign: (employee: EmployeeView) => void
): TableCell[][] {
  return employees.map((e) => [
    {
      node: (
        <div className="min-w-0">
          <div className="truncate font-semibold">{e.work.fullName}</div>
          {/* Designation, not the email: two people share a job title and it
              tells you who they are, where the address is a duplicate of the
              name you just read. The address is still searchable. */}
          <div className="truncate text-[11.5px] text-[#6B7789]">{e.work.designation}</div>
        </div>
      ),
    },
    { text: e.work.department.name },
    e.employment
      ? { text: formatJoiningDate(e.employment.joiningDate) }
      : { text: WITHHELD },
    // Shown in the directory because a missing structure is not a cosmetic
    // gap — it is the run that will refuse to process, found here instead.
    e.payroll?.salaryStructure
      ? { text: e.payroll.salaryStructure.name, sub: e.payroll.salaryStructure.currency }
      : e.payroll
        ? { tag: "Not set", tone: "red" as const }
        : { text: WITHHELD },
    // Two tags, not one replacing the other: an employee who still works here
    // but cannot log in is genuinely both, and collapsing that to one word
    // loses the fact this column exists to show.
    e.employment
      ? {
          node: (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag
                label={STATUS_LABEL[e.employment.employmentStatus]}
                tone={STATUS_TONE[e.employment.employmentStatus]}
              />
              {e.employment.accountActive ? null : <Tag label="No access" tone="red" />}
            </div>
          ),
        }
      : { text: WITHHELD },
    {
      node: (
        <RowActions
          actions={[
            { kind: "link", label: "Profile", href: `/${roleSegment}/employees/${e.id}` },
            // FINANCE gets an empty editableFields, so the salary action
            // disappears without this component learning anything about
            // Finance.
            ...(e.editableFields.length > 0
              ? [
                  {
                    kind: "custom" as const,
                    label: e.payroll?.salaryStructure ? "Change pay" : "Assign pay",
                    icon: <RiMoneyDollarCircleLine className="size-3.5" aria-hidden />,
                    onClick: () => onAssign(e),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ])
}

/**
 * Three numbers, each answering something the table itself does not.
 *
 * The headcount's sub-line used to restate the value it sat under ("47" over
 * "47 total employees"). It now splits that headcount, which is the part you
 * cannot read off the number above it.
 */
function computeStats(employees: EmployeeView[]) {
  const now = new Date()
  const withEmployment = employees.filter((e) => e.employment)
  const active = withEmployment.filter((e) => e.employment!.employmentStatus === "ACTIVE").length
  const onLeave = withEmployment.filter((e) => e.employment!.employmentStatus === "ON_LEAVE").length
  const newThisMonth = withEmployment.filter((e) => {
    const joined = new Date(e.employment!.joiningDate)
    return joined.getFullYear() === now.getFullYear() && joined.getMonth() === now.getMonth()
  }).length
  const withPayroll = employees.filter((e) => e.payroll)
  const unassigned = withPayroll.filter((e) => !e.payroll!.salaryStructure).length

  return [
    {
      label: "Headcount",
      value: String(employees.length),
      sub: `${active} active, ${onLeave} on leave`,
    },
    {
      label: "New this month",
      value: String(newThisMonth),
      sub: `Joined in ${now.toLocaleDateString("en-US", { month: "long" })}`,
    },
    // Promoted over the department count: this is the number that decides
    // whether next month's payroll can run at all.
    {
      label: "No salary structure",
      value: String(unassigned),
      sub:
        withPayroll.length === 0
          ? "Nothing to pay yet"
          : unassigned === 0
            ? "Every record is payable"
            : "Blocks payroll until assigned",
    },
  ]
}

const EMPLOYMENT_TYPES: { value: CreateStaffAccountInput["employmentType"]; label: string }[] = [
  { value: "FULL_TIME", label: "Full-time" },
  { value: "PART_TIME", label: "Part-time" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERN", label: "Intern" },
]

const STAFF_ROLES: { value: CreateStaffAccountInput["role"]; label: string }[] = [
  { value: "EMPLOYEE", label: "Employee" },
  { value: "REPORTING_MANAGER", label: "Reporting Manager" },
]

function todayIso(): string {
  return toDateString(new Date())
}

/**
 * A heading inside the create form, so nine fields read as three decisions.
 *
 * Two columns from `sm` up. Stacked, this form is nine full-width rows in a
 * dialog capped at 85svh, which puts the submit button and the validation
 * message below the fold on a laptop: you fill the form, press the button you
 * cannot see, and the error explaining what you missed is also out of view.
 */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-[#E4E9EF] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-bold tracking-wide text-[#5F6B7C] uppercase">{title}</h3>
      <div className="grid items-start gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

export function EmployeesPage() {
  const { accessToken, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()
  const pathname = usePathname()
  // "/hr/employees" → "hr". Derived rather than passed as a prop, so the four
  // route wrappers stay identical one-liners.
  const roleSegment = pathname.split("/")[1] ?? "hr"

  const [createOpen, setCreateOpen] = useState(false)
  const [result, setResult] = useState<CreateStaffAccountResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState<EmployeeView | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)

  const [search, setSearch] = useState("")
  const [departmentFilter, setDepartmentFilter] = useState<string>(ALL)
  const [statusFilter, setStatusFilter] = useState<string>(ALL)

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<CreateStaffAccountInput["role"]>("EMPLOYEE")
  const [designation, setDesignation] = useState("")
  const [departmentId, setDepartmentId] = useState("")
  const [employmentType, setEmploymentType] = useState<CreateStaffAccountInput["employmentType"]>("FULL_TIME")
  const [joiningDate, setJoiningDate] = useState(todayIso())
  const [reportingManagerId, setReportingManagerId] = useState<string>("")
  const [shiftId, setShiftId] = useState<string>("")

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(accessToken!),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  const departmentsQuery = useQuery({
    queryKey: ["departments"],
    queryFn: () => listDepartments(accessToken!),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  const structuresQuery = useQuery({
    queryKey: ["salary-structures"],
    queryFn: () => listSalaryStructures(accessToken!),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  const shiftsQuery = useQuery({
    queryKey: ["shifts"],
    queryFn: () => listShifts(accessToken!),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  // Reporting managers come from the employee list already loaded — no second
  // endpoint for a subset of rows we have.
  //
  // Only active staff: offering someone who has left produces a manager the
  // new hire reports to on paper and nowhere in practice. This cannot narrow
  // further to people who actually hold the REPORTING_MANAGER role, because
  // EmployeeView carries no role — the server makes that check on submit and
  // rejects with a named 400, so the worst case here is a rejected choice
  // rather than a bad record.
  const managers = useMemo(
    () =>
      (employeesQuery.data ?? []).filter((e) => e.employment?.employmentStatus === "ACTIVE"),
    [employeesQuery.data]
  )

  const assignMutation = useMutation({
    mutationFn: (salaryStructureId: string | null) =>
      setSalaryStructure(accessToken!, assigning!.id, salaryStructureId),
    onSuccess: () => {
      setAssigning(null)
      setAssignError(null)
      queryClient.invalidateQueries({ queryKey: ["employees"] })
    },
    onError: (err) => {
      setAssignError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const createMutation = useMutation({
    mutationFn: (input: CreateStaffAccountInput) => createStaffAccount(accessToken!, input),
    onSuccess: (created) => {
      setResult(created)
      setCopied(false)
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ["employees"] })
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  function resetForm() {
    setFullName("")
    setEmail("")
    setRole("EMPLOYEE")
    setDesignation("")
    setDepartmentId("")
    setEmploymentType("FULL_TIME")
    setJoiningDate(todayIso())
    setReportingManagerId("")
    setShiftId("")
    setFormError(null)
  }

  function handleOpenCreate() {
    resetForm()
    setCreateOpen(true)
  }

  // The event is optional because this runs from two places: the form's own
  // submit (Enter in any field) and the footer button's click.
  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setFormError(null)
    // Named, not counted. "All fields are required" was both wrong — the
    // manager and shift are optional — and useless on a nine-field form,
    // where the reader still has to find which one they missed.
    const missing = [
      !fullName && "full name",
      !email && "email",
      !designation && "designation",
      !departmentId && "department",
      !joiningDate && "joining date",
    ].filter((label): label is string => typeof label === "string")

    if (missing.length > 0) {
      setFormError(
        missing.length === 1
          ? `The ${missing[0]} is required.`
          : `These are required: ${missing.join(", ")}.`
      )
      return
    }

    createMutation.mutate({
      fullName,
      email,
      role,
      designation,
      departmentId,
      employmentType,
      joiningDate,
      ...(reportingManagerId ? { reportingManagerId } : {}),
      ...(shiftId ? { shiftId } : {}),
    })
  }

  async function handleCopy(password: string) {
    // Guarded: `navigator.clipboard` is undefined outside a secure context,
    // and this is the one string in the app that cannot be recovered if the
    // dialog closes without it being read.
    try {
      await navigator.clipboard.writeText(password)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const all = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data])
  const stats = useMemo(() => computeStats(all), [all])

  const filtersActive = search.trim() !== "" || departmentFilter !== ALL || statusFilter !== ALL

  // Name, designation, email and code are all searched: whichever of them the
  // reader happens to know is the one they will type.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return all.filter((e) => {
      if (departmentFilter !== ALL && e.work.department.id !== departmentFilter) return false
      if (statusFilter !== ALL && e.employment?.employmentStatus !== statusFilter) return false
      if (!needle) return true
      return [
        e.work.fullName,
        e.work.designation,
        e.work.email,
        e.employment?.employeeCode ?? "",
      ].some((field) => field.toLowerCase().includes(needle))
    })
  }, [all, search, departmentFilter, statusFilter])

  const rows = useMemo(
    () =>
      toRows(filtered, roleSegment, (employee) => {
        setAssignError(null)
        setAssigning(employee)
      }),
    [filtered, roleSegment]
  )

  const departments: Department[] = departmentsQuery.data ?? []

  function clearFilters() {
    setSearch("")
    setDepartmentFilter(ALL)
    setStatusFilter(ALL)
  }

  const isLoading = sessionStatus === "loading" || employeesQuery.isPending

  return (
    <>
      <PageHeader
        kicker="Management"
        title="Employees"
        sub="Everyone on the payroll, and who is missing what"
        cta="Add employee"
        onCta={handleOpenCreate}
      />

      {/* Never rendered from an empty list that only looks empty. Computed
          against no data these read "0" and "Every record is payable", which
          is not a smaller version of the truth, it is a different claim. On a
          failed load they are dropped entirely: the panel below says what
          happened, and three zeroes above it would argue with it. */}
      {employeesQuery.isError ? null : (
        <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-4">
          {isLoading
            ? [0, 1, 2].map((i) => (
                <div key={i} className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-2.5 h-6 w-12" />
                  <Skeleton className="mt-2 h-3 w-32" />
                </div>
              ))
            : stats.map((stat) => (
                <MiniStat key={stat.label} label={stat.label} value={stat.value} sub={stat.sub} />
              ))}
        </div>
      )}

      {/* Hidden while the list is loading or broken: filtering nothing is a
          control that cannot do anything, and a count of zero next to a
          skeleton reads as a real answer. */}
      {!isLoading && !employeesQuery.isError ? (
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search name, role, email or code"
          shown={filtered.length}
          total={all.length}
          noun={all.length === 1 ? "employee" : "employees"}
          active={filtersActive}
          onClear={clearFilters}
        >
          <FilterSelect
            label="Filter by department"
            value={departmentFilter}
            onChange={setDepartmentFilter}
            allLabel="All departments"
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
          <FilterSelect
            label="Filter by status"
            value={statusFilter}
            onChange={setStatusFilter}
            allLabel="All statuses"
            options={STATUS_OPTIONS}
          />
        </FilterBar>
      ) : null}

      <PanelTable
        cols="1.6fr 0.9fr 0.7fr 1fr 0.9fr 1.1fr"
        headers={["Employee", "Department", "Joined", "Salary structure", "Status", ""]}
        rows={rows}
        isLoading={isLoading}
        isError={employeesQuery.isError}
        onRetry={() => employeesQuery.refetch()}
        // The two ways this table can be empty want different words and
        // different buttons: one is a directory nobody has filled in, the
        // other is a search that went too narrow.
        emptyTitle={filtersActive ? "No employees match" : "No employees yet"}
        emptyBody={
          filtersActive
            ? "Nothing in the directory matches this search and these filters together. Widen one of them."
            : "Once the first employee is added they appear here, along with anything their record is still missing."
        }
        emptyAction={filtersActive ? "Clear filters" : "Add employee"}
        emptyActionIcon={
          filtersActive ? <RiFilterOffLine className="size-4" aria-hidden /> : undefined
        }
        onEmptyAction={filtersActive ? clearFilters : handleOpenCreate}
      />

      <SalaryStructureDialog
        employee={assigning}
        structures={structuresQuery.data ?? []}
        pending={assignMutation.isPending}
        error={assignError}
        onOpenChange={(open) => !open && setAssigning(null)}
        onSubmit={(salaryStructureId) => assignMutation.mutate(salaryStructureId)}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        {/*
          No max-height here: DialogContent already caps itself at 85svh and
          scrolls, and `svh` rather than `vh` is what keeps the footer clear of
          a mobile browser's collapsing address bar.

          The width needs the `!`. tailwind-merge does drop the primitive's
          `sm:max-w-sm`, but its `max-w-[calc(100%-2rem)]` survives, and
          Tailwind v4 emits arbitrary utilities after named ones, so at equal
          specificity the calc wins and the dialog fills the viewport.
        */}
        <DialogContent className="sm:max-w-2xl!">
          <DialogHeader>
            <DialogTitle>Add employee</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormSection title="Person">
              <Field label="Full name" htmlFor="fullName">
                <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </Field>
              <Field
                label="Email"
                htmlFor="email"
                hint="Their login, and where the temporary password is sent."
              >
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Role">
                <Select value={role} onValueChange={(v) => setRole(v as CreateStaffAccountInput["role"])}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string | null) => STAFF_ROLES.find((r) => r.value === v)?.label ?? v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {STAFF_ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormSection>

            <FormSection title="Position">
              <Field label="Designation" htmlFor="designation">
                <Input id="designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
              </Field>
              <Field label="Department">
                <Select value={departmentId} onValueChange={(v) => setDepartmentId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string | null) => departments.find((d) => d.id === v)?.name ?? "Select a department"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Reporting manager" hint="Optional. Leave unset if they report to nobody in the system.">
                <Select value={reportingManagerId} onValueChange={(v) => setReportingManagerId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string | null) =>
                        managers.find((m) => m.id === v)?.work.fullName ?? "No manager"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {managers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.work.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </FormSection>

            <FormSection title="Terms">
              <Field label="Employment type">
                <Select
                  value={employmentType}
                  onValueChange={(v) => setEmploymentType(v as CreateStaffAccountInput["employmentType"])}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string | null) => EMPLOYMENT_TYPES.find((t) => t.value === v)?.label ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {/* Stated rather than left to a silent fallback: an unassigned shift is
                  judged against General's window, which is wrong for night staff. */}
              <Field label="Shift" hint="Leave unset to use the General shift.">
                <Select value={shiftId} onValueChange={(v) => setShiftId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string | null) => shiftsQuery.data?.find((s) => s.id === v)?.name ?? "General"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(shiftsQuery.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.startTime} to {s.endTime})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Joining date">
                <DatePicker value={joiningDate} onChange={setJoiningDate} />
              </Field>
            </FormSection>

            {formError ? <FormError>{formError}</FormError> : null}

            <DialogFooter>
              <DialogActions
                pending={createMutation.isPending}
                submitLabel="Create employee"
                disabled={false}
                onCancel={() => setCreateOpen(false)}
                onSubmit={() => handleSubmit()}
              />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!result} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{result?.fullName} was added</DialogTitle>
          </DialogHeader>
          {result ? (
            <div className="space-y-4 text-[13px]">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-[#5F6B7C]">Employee code</dt>
                <dd className="font-semibold">{result.employeeCode}</dd>
                <dt className="text-[#5F6B7C]">Email</dt>
                <dd className="truncate font-semibold">{result.email}</dd>
              </dl>

              <div>
                <div className="mb-1.5 text-[11px] font-bold tracking-wide text-[#5F6B7C] uppercase">
                  Temporary password
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 rounded-md border border-[#E4E9EF] bg-[#F4F6F9] px-3 py-2 font-mono text-[13px] break-all">
                    {result.temporaryPassword}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleCopy(result.temporaryPassword)}
                    className="h-auto shrink-0 rounded-md px-3 py-2 text-[12.5px] font-semibold"
                  >
                    {copied ? (
                      <RiCheckLine className="size-4 text-[#1E7A3C]" aria-hidden />
                    ) : (
                      <RiFileCopyLine className="size-4" aria-hidden />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              {/* An alert rather than grey prose: this is the only screen the
                  password ever appears on, and closing the dialog destroys it. */}
              <p
                role="alert"
                className="rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#8A5E0C]"
              >
                This password is shown once and cannot be retrieved after this dialog closes. It has
                also been emailed to {result.email}, or written to the server log in dev mode.
              </p>

              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => setResult(null)}
                  className="h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
