"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiArrowRightSLine, RiCloseLine, RiSearchLine, RiUserSearchLine } from "@remixicon/react"

import { cn } from "@/lib/utils"
import { listEmployees } from "@/lib/api/employees"
import { useSession } from "@/lib/auth/session-context"
import type { EmployeeView } from "@/lib/api/types"
import { ColleagueDialog } from "@/components/directory/colleague-dialog"
import { FilterChip } from "@/components/dashboard/filter-chip"
import { UserAvatar } from "@/components/dashboard/user-avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Heading } from "@/components/ds/heading"

const ALL_DEPARTMENTS = "__all__"

/** 28ms apart, capped at ten steps. Stagger is decorative; a 200-person
    directory must not make the last card wait six seconds to appear, and
    280ms of total cascade is already at the edge of feeling deliberate. */
const STAGGER_STEP_MS = 28
const STAGGER_MAX_STEPS = 10

/**
 * Reads the widened list endpoint. For an EMPLOYEE caller the rows come back
 * as work-identity only, so the colleague card *is* the COLLEAGUE projection —
 * no second endpoint, and no chance of the two disagreeing.
 */
export function DirectoryPage() {
  const { accessToken, status: sessionStatus } = useSession()
  const [query, setQuery] = useState("")
  const [department, setDepartment] = useState<string>(ALL_DEPARTMENTS)
  const [selected, setSelected] = useState<EmployeeView | null>(null)

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(accessToken!),
    enabled: sessionStatus === "authenticated" && !!accessToken,
  })

  const all = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data])

  // Filtering is client-side, consistent with the existing no-pagination
  // decision for this dataset size.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return all.filter((e) => {
      if (department !== ALL_DEPARTMENTS && e.work.department.id !== department) return false
      if (needle === "") return true
      return [e.work.fullName, e.work.designation, e.work.department.name]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    })
  }, [all, query, department])

  const departments = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>()
    for (const e of all) {
      const existing = byId.get(e.work.department.id)
      if (existing) existing.count += 1
      else byId.set(e.work.department.id, { ...e.work.department, count: 1 })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [all])

  // The cascade belongs to the first paint of the list, not to every keystroke
  // in the search box. Once it has played out the flag flips off, so filtering
  // re-renders the grid without re-animating what is left of it — which is the
  // difference between a directory that feels alive and one that flickers.
  const listReady = !employeesQuery.isPending && !employeesQuery.isError
  const [stagger, setStagger] = useState(true)
  useEffect(() => {
    if (!listReady) return
    const total = STAGGER_STEP_MS * STAGGER_MAX_STEPS + 300
    const timer = setTimeout(() => setStagger(false), total)
    return () => clearTimeout(timer)
  }, [listReady])

  const filtering = query.trim() !== "" || department !== ALL_DEPARTMENTS

  function clearFilters() {
    setQuery("")
    setDepartment(ALL_DEPARTMENTS)
  }

  return (
    <>
      <div className="pt-7 pb-5">
        <div className="mb-1.5 text-caption font-bold tracking-[1.1px] text-ink-muted uppercase">
          Workspace
        </div>
        <Heading level="page" className="mb-1">Directory</Heading>
        <div className="text-body-sm text-ink-muted">
          Find a colleague — who they are, what they do and how to reach them.
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3">
        <div className="relative max-w-100">
          <RiSearchLine
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
          />
          <input
            type="search"
            placeholder="Search by name, designation or department"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the directory"
            // Not ui/input: that primitive owns its own padding, and a leading
            // icon plus a trailing clear button needs both sides opened up.
            className="h-10 w-full rounded-md border border-line bg-white pr-9 pl-9 text-body-sm transition-[border-color,box-shadow] duration-150 ease-out-quint outline-none placeholder:text-ink-muted hover:border-line-strong focus:border-ink focus:shadow-[0_0_0_3px_rgba(23,25,28,0.08)] motion-reduce:transition-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded text-ink-muted transition-[transform,color,background-color] duration-150 ease-out-quint hover:bg-surface-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none active:scale-90 motion-reduce:transition-none"
            >
              <RiCloseLine className="size-4" />
            </button>
          ) : null}
        </div>

        {/* Department is the one facet people actually filter a directory by,
            and it is cheap: the rows already carry it, so no extra request and
            no server-side filter to keep in step. Hidden when there is only
            one department, where the row would be a control with no choice. */}
        {departments.length > 1 ? (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            <FilterChip
              label="Everyone"
              count={all.length}
              active={department === ALL_DEPARTMENTS}
              onClick={() => setDepartment(ALL_DEPARTMENTS)}
            />
            {departments.map((dept) => (
              <FilterChip
                key={dept.id}
                label={dept.name}
                count={dept.count}
                active={department === dept.id}
                onClick={() => setDepartment(dept.id)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {sessionStatus === "loading" || employeesQuery.isPending ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-4">
          {/* Six, and shaped like the card they stand in for — three rows of
              text under a 44px square. A skeleton that does not match what
              replaces it produces a layout jump at exactly the moment the
              page is meant to feel finished. */}
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-md border border-line bg-white px-4 py-3.5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-11 shrink-0 rounded-md" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
              </div>
              <Skeleton className="mt-3.5 h-2.5 w-28" />
            </div>
          ))}
        </div>
      ) : employeesQuery.isError ? (
        <div className="rounded-md border border-line bg-white p-5.5 text-body-sm text-danger">
          Failed to load the directory.{" "}
          <Button
            variant="link"
            className="h-auto p-0 font-semibold underline"
            onClick={() => employeesQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="fade-in grid place-items-center rounded-md border border-dashed border-line bg-white px-6 py-14 text-center">
          <RiUserSearchLine aria-hidden="true" className="mb-3 size-7 text-line-strong" />
          <p className="text-body-sm font-semibold">No colleagues match that</p>
          <p className="mt-1 max-w-80 text-caption text-ink-muted">
            Try a shorter search, or widen the department filter.
          </p>
          {filtering ? (
            <Button
              type="button"
              variant="outline"
              onClick={clearFilters}
              className="mt-4 transition-transform duration-150 ease-out-quint active:scale-97 motion-reduce:transition-none"
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div
            aria-live="polite"
            className="mb-2.5 text-caption text-ink-muted"
          >
            {filtered.length} {filtered.length === 1 ? "colleague" : "colleagues"}
            {filtering ? ` of ${all.length}` : ""}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(236px,1fr))] gap-4">
            {filtered.map((employee, i) => (
              <ColleagueCard
                key={employee.id}
                employee={employee}
                onOpen={() => setSelected(employee)}
                delayMs={stagger ? Math.min(i, STAGGER_MAX_STEPS) * STAGGER_STEP_MS : 0}
                animate={stagger}
              />
            ))}
          </div>
        </>
      )}

      <ColleagueDialog employee={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </>
  )
}

/**
 * The whole card is the button. The previous version put a "View details"
 * control inside an inert card, on the grounds that a card-sized hit area was
 * awkward to describe to a screen reader — but the card holds nothing else
 * interactive (email and phone are `mailto:`/`tel:` links inside the dialog),
 * so there is nothing to nest, and an explicit `aria-label` describes it
 * exactly. What is left is a directory where pressing a person opens them,
 * which is what everyone tries first.
 */
function ColleagueCard({
  employee,
  onOpen,
  delayMs,
  animate,
}: {
  employee: EmployeeView
  onOpen: () => void
  delayMs: number
  animate: boolean
}) {
  const { fullName, designation, department, avatarUrl } = employee.work

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${fullName}, ${designation} in ${department.name}. View details`}
      style={animate ? { animationDelay: `${delayMs}ms` } : undefined}
      className={cn(
        "group flex flex-col gap-3 rounded-md border border-line bg-white px-4 py-3.5 text-left",
        // transform and opacity only, and both under 300ms. The lift is 2px:
        // enough that the card under the cursor is unambiguous, small enough
        // that a grid of them does not ripple.
        "transition-[transform,border-color,box-shadow] duration-200 ease-out-quint",
        "hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_6px_18px_-8px_rgba(23,39,51,0.28)]",
        "focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none",
        // The press cancels the hover lift and dips below rest, so the card
        // reads as pushed rather than merely stopped.
        "active:translate-y-0 active:scale-99 active:duration-100",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        animate && "rise-in"
      )}
    >
      <div className="flex items-center gap-3">
        <UserAvatar
          name={fullName}
          avatarUrl={avatarUrl}
          className="size-11 rounded-md"
          textClassName="text-body"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-sm font-semibold">{fullName}</div>
          <div className="truncate text-caption text-ink-muted">{designation}</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-surface-sunken pt-2.5">
        <span className="truncate text-caption font-medium text-ink-muted">
          {department.name}
        </span>
        {/* The affordance, not a second control: it says which way the card
            goes without adding a target that competes with the card itself. */}
        <span className="flex shrink-0 items-center gap-0.5 text-caption font-semibold text-ink-muted transition-colors duration-200 ease-out-quint group-hover:text-ink motion-reduce:transition-none">
          Details
          <RiArrowRightSLine
            aria-hidden="true"
            className="size-3.5 transition-transform duration-200 ease-out-quint group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        </span>
      </div>
    </button>
  )
}
