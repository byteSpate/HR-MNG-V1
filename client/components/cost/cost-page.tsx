"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RiArrowLeftSLine, RiArrowRightSLine, RiErrorWarningLine } from "@remixicon/react"

import { getCostSummary, listCostCategories, listCostCommitments, listCosts } from "@/lib/api/costs"
import { useSession } from "@/lib/auth/session-context"
import type { CostBill, CostCommitment, Currency } from "@/lib/api/types"
import type { PeriodRelation } from "@/components/cost/cost-shared"
import { formatMoney } from "@/lib/money"
import { ALL, FilterBar, FilterSelect } from "@/components/dashboard/filter-bar"
import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, PanelTable } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CommitmentDialog } from "@/components/cost/commitment-dialog"
import { CostDialog, type CostPrefill } from "@/components/cost/cost-dialog"
import {
  canManageCosts,
  canReadCosts,
  currentPeriod,
  formatCostDate,
  monthName,
  ordinalDay,
  relateToNow,
  startedOnOrBefore,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/components/cost/cost-shared"
import { ImportWizard } from "@/components/cost/import-wizard"
import { PayDialog } from "@/components/cost/pay-dialog"

type Period = { year: number; month: number }

function shiftPeriod({ year, month }: Period, delta: number): Period {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

/** What every table on this page needs to render its own four states. */
interface TableState {
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

/**
 * The period control, in the page header beside the primary action.
 *
 * A `<input type="month">` was here before. It is the obvious control and the
 * wrong one: stepping to the previous month is the overwhelmingly common move
 * on this page, and a native month input makes that a two-click popover on
 * every browser that implements it at all. The arrows are the whole control,
 * and the label between them is its value.
 */
function MonthStepper({
  period,
  onShift,
}: {
  period: Period
  /**
   * A delta, not the computed next period. Taking the next value meant the
   * handler closed over `period`, so two clicks inside one React batch both
   * derived from the same stale month and the second did nothing: a quick
   * double-click on the arrow moved one month, not two.
   */
  onShift: (delta: number) => void
}) {
  return (
    <div
      role="group"
      aria-label="Month shown"
      className="flex items-center gap-0.5 rounded-md border border-[#E4E9EF] bg-white p-0.5"
    >
      <Button
        type="button"
        variant="ghost"
        aria-label="Previous month"
        onClick={() => onShift(-1)}
        className="size-8 rounded p-0 text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
      >
        <RiArrowLeftSLine className="size-4" aria-hidden />
      </Button>
      <span aria-live="polite" className="min-w-[130px] text-center text-[13px] font-bold">
        {monthName(period.month)} {period.year}
      </span>
      <Button
        type="button"
        variant="ghost"
        aria-label="Next month"
        onClick={() => onShift(1)}
        className="size-8 rounded p-0 text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
      >
        <RiArrowRightSLine className="size-4" aria-hidden />
      </Button>
    </div>
  )
}

/**
 * The status pill plus whatever qualifies it, as one cell.
 *
 * Kept as `Badge` rather than the kit's `Tag`: the cost tones in
 * `cost-shared.ts` are Tailwind class strings carrying their own `dark:`
 * variants, and `Tone` is a closed four-value union with no equivalent, so
 * converting would quietly drop dark mode.
 */
function badgeCell(
  className: string,
  label: string,
  sub?: string,
  /**
   * The sub-line's tone. Defaults to muted rather than to the alert red: an
   * ended commitment's closing date and an overdue bill both sit under a
   * badge, and only one of them is a problem.
   */
  subTone: "muted" | "alert" = "muted"
): TableCell {
  return {
    node: (
      <div className="flex flex-col items-start gap-1">
        <Badge className={className}>{label}</Badge>
        {sub ? (
          <span
            className={
              subTone === "alert"
                ? "text-xs font-semibold text-[#B03A3A]"
                : "text-xs text-[#5F6B7C]"
            }
          >
            {sub}
          </span>
        ) : null}
      </div>
    ),
  }
}

function BillsTable({
  bills,
  canManage,
  onView,
  onPay,
  filtersActive,
  onCreate,
  relation,
  monthLabel,
  ...state
}: TableState & {
  bills: CostBill[]
  canManage: boolean
  onView: (id: string) => void
  onPay: (id: string) => void
  filtersActive: boolean
  onCreate: () => void
  relation: PeriodRelation
  monthLabel: string
}) {
  const rows: TableCell[][] = bills.map((bill) => [
    // The code under the name, the way the settings screen shows it. It is
    // what the bill posts against, so a reader reconciling to the ledger needs
    // it on the row rather than a click away.
    { text: bill.category.name, sub: bill.category.code },
    { text: bill.label, weight: 600 },
    { text: bill.payee },
    { text: formatMoney(bill.amount, bill.currency) },
    { text: formatCostDate(bill.dueDate) },
    // `isOverdue` comes from the server and is never recomputed here: there is
    // no stored overdue flag to recompute from in the first place.
    badgeCell(
      STATUS_TONE[bill.status],
      STATUS_LABEL[bill.status],
      bill.isOverdue ? "Overdue" : undefined,
      "alert"
    ),
    {
      node: (
        <div className="flex justify-end gap-2 whitespace-nowrap">
          <Button type="button" size="sm" variant="outline" onClick={() => onView(bill.id)}>
            {canManage ? "Edit" : "View"}
          </Button>
          {canManage && bill.status === "PENDING" ? (
            <Button type="button" size="sm" onClick={() => onPay(bill.id)}>
              Mark paid
            </Button>
          ) : null}
        </div>
      ),
    },
  ])

  return (
    <PanelTable
      cols="0.9fr 1.3fr 1fr 0.9fr 0.9fr 0.9fr 1fr"
      headers={["Category", "Bill", "Payee", "Amount", "Due", "Status", ""]}
      rows={rows}
      emptyTitle={
        filtersActive
          ? "No bills match"
          : relation === "future"
            ? `${monthLabel} has not started`
            : "Nothing recorded this month"
      }
      emptyBody={
        filtersActive
          ? "Try a different category or clear the search."
          : relation === "future"
            ? // Not "nothing recorded", which reads as an omission. A bill can
              // legitimately arrive before its month does, so the action stays.
              "Nothing here is late. A bill that arrives early can still be recorded against this month."
            : "Rent, electricity, water, internet and cleaning are recorded one bill per category, per month."
      }
      emptyAction={filtersActive || !canManage ? "Refresh" : "Record a bill"}
      onEmptyAction={filtersActive || !canManage ? state.onRetry : onCreate}
      {...state}
    />
  )
}

function CommitmentsTable({
  commitments,
  canManage,
  onEdit,
  filtersActive,
  onCreate,
  ...state
}: TableState & {
  commitments: CostCommitment[]
  canManage: boolean
  onEdit: (c: CostCommitment) => void
  filtersActive: boolean
  onCreate: () => void
}) {
  const rows: TableCell[][] = commitments.map((c) => [
    { text: c.category?.name ?? "" },
    { text: c.label, weight: 600 },
    { text: c.payee },
    // A blank amount is not missing data: a commitment with no fixed amount is
    // how a metered bill is recorded, so it says so.
    { text: c.amount ? formatMoney(c.amount, c.currency) : "Varies" },
    { text: c.dueDay != null ? `Day ${c.dueDay}` : "" },
    { text: formatCostDate(c.startedOn) },
    c.endedOn
      ? badgeCell(
          "bg-neutral-100 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-300",
          "Ended",
          formatCostDate(c.endedOn)
        )
      : badgeCell(
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
          "Active"
        ),
    ...(canManage
      ? [
          {
            node: (
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => onEdit(c)}>
                  Edit
                </Button>
              </div>
            ),
          } as TableCell,
        ]
      : []),
  ])

  return (
    <PanelTable
      cols={
        canManage
          ? "0.9fr 1.3fr 1fr 0.9fr 0.7fr 0.9fr 0.9fr 0.7fr"
          : "0.9fr 1.3fr 1fr 0.9fr 0.7fr 0.9fr 0.9fr"
      }
      headers={[
        "Category",
        "Label",
        "Payee",
        "Amount",
        "Due day",
        "Started",
        "Status",
        ...(canManage ? [""] : []),
      ]}
      rows={rows}
      emptyTitle={filtersActive ? "No fixed costs match" : "No fixed costs"}
      emptyBody={
        filtersActive
          ? "Try a different status or clear the search."
          : "A fixed cost is what makes a missing bill visible: without one, an empty month looks the same as a month nobody entered."
      }
      emptyAction={filtersActive || !canManage ? "Refresh" : "New fixed cost"}
      onEmptyAction={filtersActive || !canManage ? state.onRetry : onCreate}
      {...state}
    />
  )
}

/**
 * Commitments with no bill against them yet, in one block.
 *
 * Two tones, one component. `late` is a chase: the due day has passed and
 * nobody entered the bill. `upcoming` is not a problem at all, so it must not
 * borrow the alarm colour; it is either the rest of this month or, on a future
 * month, the whole of what is coming.
 */
function ExpectationList({
  tone,
  heading,
  commitments,
  canManage,
  onRecord,
}: {
  tone: "late" | "upcoming"
  heading: string
  commitments: CostCommitment[]
  canManage: boolean
  onRecord: (c: CostCommitment) => void
}) {
  const late = tone === "late"
  return (
    <div
      className={
        late
          ? "rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-4 py-3"
          : "rounded-md border border-[#E4E9EF] bg-white px-4 py-3"
      }
    >
      <div
        className={
          late
            ? "text-[12.5px] font-semibold text-[#8A5E0C]"
            : "text-[12.5px] font-semibold text-[#1C2733]"
        }
      >
        {heading}
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {commitments.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className={late ? "text-[12.5px] text-[#8A5E0C]" : "text-[12.5px] text-[#5F6B7C]"}>
              {c.label}
              <span className={late ? "text-[#A9803C]" : "text-[#8792A3]"}> to {c.payee}</span>
              {c.dueDay != null ? (
                <span className={late ? "text-[#A9803C]" : "text-[#8792A3]"}>
                  , due the {ordinalDay(c.dueDay)}
                </span>
              ) : null}
            </span>
            {canManage ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRecord(c)}
                className={
                  late
                    ? "h-auto rounded-md px-2 py-1 text-[12px] font-bold text-[#8A5E0C] underline transition-colors hover:bg-[#F8EEDA]"
                    : "h-auto rounded-md px-2 py-1 text-[12px] font-bold text-[#5F6B7C] underline transition-colors hover:bg-[#F1F4F8] hover:text-[#1C2733]"
                }
              >
                {/* "Record it early" on a bill that is not due yet: the same
                    label as the chase list would imply this one is late too. */}
                {late ? "Record it" : "Record it early"}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Four stat cards' worth of skeleton, shaped like the cards they replace. */
function StatSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2.5 h-6 w-24" />
          <Skeleton className="mt-1.5 h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

/**
 * One component, three roles (Finance and Super Admin write; HR reads).
 * Managers and employees have no nav entry to this route and no server route
 * to call, so this component never runs a query for them.
 *
 * The month is the screen: the totals, the bill table and the missing-bill
 * prompts are all scoped to whichever `period` the header's stepper is on.
 */
export function CostPage() {
  const { accessToken, user, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()

  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const role = user?.role
  const canManage = !!role && canManageCosts(role)
  const readable = !!role && canReadCosts(role)

  const [period, setPeriod] = useState<Period>(currentPeriod())
  const [costDialog, setCostDialog] = useState<{ costId: string | null; prefill?: CostPrefill } | null>(
    null
  )
  const [payTarget, setPayTarget] = useState<string | null>(null)
  const [commitmentTarget, setCommitmentTarget] = useState<CostCommitment | "new" | null>(null)

  // Controlled, so the overdue strip can send the reader to the bills it
  // counts rather than naming a number on a tab they are not looking at.
  const [tab, setTab] = useState("bills")
  const [billSearch, setBillSearch] = useState("")
  const [billCategory, setBillCategory] = useState(ALL)
  const [billOverdueOnly, setBillOverdueOnly] = useState(false)
  const [commitmentSearch, setCommitmentSearch] = useState("")
  const [commitmentStatus, setCommitmentStatus] = useState(ALL)

  const categoriesQuery = useQuery({
    queryKey: ["costs", "categories"],
    queryFn: () => listCostCategories(accessToken!),
    enabled: isAuthed && readable,
  })

  const summaryQuery = useQuery({
    queryKey: ["cost-summary", period.year, period.month],
    queryFn: () => getCostSummary(accessToken!, period.year, period.month),
    enabled: isAuthed && readable,
  })

  const billsQuery = useQuery({
    queryKey: ["costs", "bills", period.year, period.month],
    queryFn: () => listCosts(accessToken!, { year: period.year, month: period.month }),
    enabled: isAuthed && readable,
  })

  // Unfiltered: this list feeds both the "missing bill" prompts (active
  // commitments only) and the Commitments tab (which shows ended ones too).
  const commitmentsQuery = useQuery({
    queryKey: ["costs", "commitments"],
    queryFn: () => listCostCommitments(accessToken!),
    enabled: isAuthed && readable,
  })

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["costs"] })
    queryClient.invalidateQueries({ queryKey: ["cost-summary", period.year, period.month] })
  }

  const categories = categoriesQuery.data ?? []
  // Memoised, unlike `categories`: a bare `?? []` mints a new array on every
  // render, which would make the filter memos below recompute every time and
  // defeat the point of having them.
  const bills = useMemo(() => billsQuery.data ?? [], [billsQuery.data])
  const commitments = useMemo(() => commitmentsQuery.data ?? [], [commitmentsQuery.data])

  const billFiltersActive = billSearch.trim() !== "" || billCategory !== ALL || billOverdueOnly
  const visibleBills = useMemo(() => {
    const q = billSearch.trim().toLowerCase()
    return bills.filter((b) => {
      if (billOverdueOnly && !b.isOverdue) return false
      if (billCategory !== ALL && b.categoryId !== billCategory) return false
      if (!q) return true
      return (
        b.label.toLowerCase().includes(q) ||
        b.payee.toLowerCase().includes(q) ||
        b.category.name.toLowerCase().includes(q)
      )
    })
  }, [bills, billSearch, billCategory, billOverdueOnly])

  const commitmentFiltersActive = commitmentSearch.trim() !== "" || commitmentStatus !== ALL
  const visibleCommitments = useMemo(() => {
    const q = commitmentSearch.trim().toLowerCase()
    return commitments.filter((c) => {
      if (commitmentStatus === "active" && c.endedOn) return false
      if (commitmentStatus === "ended" && !c.endedOn) return false
      if (!q) return true
      return (
        c.label.toLowerCase().includes(q) ||
        c.payee.toLowerCase().includes(q) ||
        (c.category?.name ?? "").toLowerCase().includes(q)
      )
    })
  }, [commitments, commitmentSearch, commitmentStatus])

  // An active commitment with no bill recorded for this exact period. This is
  // the only reason CostCommitment exists: without it the table cannot tell
  // "nothing owed this month" from "nobody entered it".
  //
  // Both lists have to have actually arrived. `bills` is `[]` while the query
  // is pending and again when it fails, and deriving from that empty array
  // announced every active commitment as unrecorded, so a dropped request
  // rendered as four missing bills and an instruction to enter them again.
  const billsKnown = !billsQuery.isPending && !billsQuery.isError
  const commitmentsKnown = !commitmentsQuery.isPending && !commitmentsQuery.isError
  // Memoised for the same reason the filtered lists are: a fresh array every
  // render would make the split below recompute every time. The billed-id set
  // is built inside rather than above, so `bills` is the only dependency and
  // no derived value has to be declared to the hook.
  const expected = useMemo(() => {
    if (!billsKnown || !commitmentsKnown) return []
    const billed = new Set(bills.filter((b) => b.commitmentId).map((b) => b.commitmentId))
    return commitments.filter(
      (c) =>
        c.endedOn === null &&
        startedOnOrBefore(c.startedOn, period.year, period.month) &&
        !billed.has(c.id)
    )
  }, [bills, commitments, billsKnown, commitmentsKnown, period.year, period.month])

  const relation = relateToNow(period.year, period.month)

  /**
   * Splitting `expected` into what is genuinely late and what is simply not
   * due yet.
   *
   * Every unbilled commitment used to be reported as "has not been recorded",
   * in amber, whatever month was on screen. Stepping to September therefore
   * accused Finance of missing four bills for a month that has not started,
   * and even in the current month it flagged the cleaning bill as missing on
   * the 11th when it is not due until the 20th.
   *
   * A commitment with no due day is only late once the month is over: there is
   * no date within the month at which it can be said to have been missed.
   */
  const { late, upcoming } = useMemo(() => {
    if (relation === "future") return { late: [], upcoming: expected }
    if (relation === "past") return { late: expected, upcoming: [] as CostCommitment[] }
    const today = new Date().getDate()
    return {
      late: expected.filter((c) => c.dueDay != null && c.dueDay < today),
      upcoming: expected.filter((c) => c.dueDay == null || c.dueDay >= today),
    }
  }, [expected, relation])

  /**
   * What a future month is contracted to cost, per currency.
   *
   * A floor, not a prediction, and labelled as one: metered commitments carry
   * no amount, so they are counted and named rather than folded in at zero,
   * which would have understated the month while looking precise.
   */
  const forecast = useMemo(() => {
    if (relation !== "future") return []
    const byCurrency = new Map<Currency, { total: number; fixed: number; metered: number }>()
    for (const c of upcoming) {
      const entry = byCurrency.get(c.currency) ?? { total: 0, fixed: 0, metered: 0 }
      // Metered commitments are counted against their own currency, not
      // against every currency on the page: a single BDT electricity bill was
      // being declared on the USD card too, which claimed a metered bill that
      // currency does not have.
      if (c.amount == null) {
        entry.metered += 1
      } else {
        entry.total += Number(c.amount)
        entry.fixed += 1
      }
      byCurrency.set(c.currency, entry)
    }
    return (
      [...byCurrency.entries()]
        .map(([currency, v]) => ({ currency, ...v }))
        // A currency with nothing but metered commitments has no committed
        // amount to state, and a card reading "0.00" would understate it. The
        // expectation list below still names every one of them.
        .filter((f) => f.fixed > 0)
    )
  }, [relation, upcoming])

  function openCreate() {
    setCostDialog({ costId: null })
  }

  function openCreateFromCommitment(commitment: CostCommitment) {
    const dueDate =
      commitment.dueDay != null
        ? `${period.year}-${String(period.month).padStart(2, "0")}-${String(commitment.dueDay).padStart(2, "0")}`
        : undefined
    setCostDialog({
      costId: null,
      prefill: {
        categoryId: commitment.categoryId,
        label: commitment.label,
        payee: commitment.payee,
        commitmentId: commitment.id,
        amount: commitment.amount,
        currency: commitment.currency,
        dueDate,
      },
    })
  }

  if (sessionStatus === "loading") {
    return (
      <div className="pt-7">
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const summary = summaryQuery.data

  return (
    <>
      <PageHeader
        kicker="Workspace"
        title="Expenses"
        sub="What the company itself spends — rent, utilities, salaries, office and entertainment — one bill per category each month"
        aside={<MonthStepper period={period} onShift={(d) => setPeriod((p) => shiftPeriod(p, d))} />}
        cta={canManage ? "Record a bill" : undefined}
        onCta={openCreate}
      />

      {readable ? (
        <div className="space-y-5">
          {/* A future month has no totals to report, so the stat row would
              simply be absent. What it can report is what the month is already
              contracted to cost. */}
          {relation === "future" && forecast.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {forecast.map((f) => (
                <MiniStat
                  key={f.currency}
                  label={`Committed (${f.currency})`}
                  value={formatMoney(String(f.total), f.currency)}
                  sub={
                    f.metered > 0
                      ? `${f.fixed} fixed, ${f.metered} metered not counted`
                      : `${f.fixed} fixed commitment${f.fixed === 1 ? "" : "s"}`
                  }
                />
              ))}
            </div>
          ) : null}

          {/* The skeleton is skipped on a future month, where an empty result
              is the expected one and four pulsing placeholders would promise
              figures that are never coming. Real totals still render below if
              a bill was entered ahead of time, and an error is still an
              error whichever month is on screen. */}
          {relation === "future" && summaryQuery.isPending ? null : summaryQuery.isPending ? (
            <StatSkeletons />
          ) : summaryQuery.isError ? (
            <PanelAlert>
              This month&rsquo;s totals could not be loaded.{" "}
              <Button
                variant="link"
                className="h-auto p-0 text-[12.5px] font-bold text-[#B03A3A] underline"
                onClick={() => summaryQuery.refetch()}
              >
                Retry
              </Button>
            </PanelAlert>
          ) : summary ? (
            <div className="space-y-3">
              {/* No "nothing recorded yet" line here. The bills table below
                  says exactly that, in its own empty state, with the button
                  that fixes it; saying it twice on one screen just moved the
                  table further down. */}
              {summary.totals.length === 0 ? null : (
                <>
                  {/* One row per currency. Almost always just BDT, but a USD
                      bill gets its own line rather than being folded into the
                      BDT figure, because the sum of two currencies is not
                      money. */}
                  {summary.totals.map((t) => (
                    <div key={t.currency} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <MiniStat
                        label={`Total (${t.currency})`}
                        value={formatMoney(t.total, t.currency)}
                        sub={monthName(period.month)}
                      />
                      <MiniStat
                        label="Paid"
                        value={formatMoney(t.paid, t.currency)}
                        sub="settled this month"
                      />
                      <MiniStat
                        label="Outstanding"
                        value={formatMoney(t.outstanding, t.currency)}
                        sub="not yet paid"
                      />
                    </div>
                  ))}
                  {/*
                    Outside the currency loop, and no longer a stat card.

                    `overdueCount` counts bills across every currency, so
                    rendering it inside the map printed the same number once per
                    currency, each time sitting in a row headed "Total (BDT)" or
                    "Total (USD)" and reading as that currency's share. Pulled
                    out, it was a lone card in a two-thirds empty row, still
                    pretending to be money when it is a count of documents.

                    As a strip it can do the thing the number is for: take you
                    to the bills it counts.
                  */}
                  {summary.overdueCount > 0 ? (
                    <Button
                      type="button"
                      aria-pressed={billOverdueOnly}
                      onClick={() => {
                        setTab("bills")
                        setBillOverdueOnly((prev) => !prev)
                      }}
                      className="flex h-auto w-full items-center gap-2 rounded-md border border-[#F0D2D2] bg-[#FDF6F6] px-4 py-2.5 text-left text-[12.5px] font-semibold text-[#B03A3A] transition-colors hover:bg-[#FBEDED]"
                    >
                      <RiErrorWarningLine className="size-4 shrink-0" aria-hidden />
                      <span>
                        {summary.overdueCount === 1
                          ? "1 bill is past its due date"
                          : `${summary.overdueCount} bills are past their due date`}
                      </span>
                      <span className="ml-auto shrink-0 underline">
                        {billOverdueOnly ? "Show every bill" : "Show only these"}
                      </span>
                    </Button>
                  ) : null}
                </>
              )}

              {summary.categories.length > 0 ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {summary.categories.map((c) => (
                    // Keyed on category AND currency: one category can
                    // legitimately produce two rows, and categoryId alone
                    // would collide.
                    <MiniStat
                      key={`${c.categoryId}-${c.currency}`}
                      label={c.categoryName}
                      value={formatMoney(c.total, c.currency)}
                      sub={`${c.billCount} bill${c.billCount === 1 ? "" : "s"}, ${formatMoney(c.outstanding, c.currency)} due`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Late first, then not-yet-due. One block each, not one banner per
              commitment: five unbilled commitments used to stack five separate
              amber strips and push the table below the fold. */}
          {late.length > 0 ? (
            <ExpectationList
              tone="late"
              heading={
                late.length === 1
                  ? `One expected bill has not been recorded for ${monthName(period.month)}.`
                  : `${late.length} expected bills have not been recorded for ${monthName(period.month)}.`
              }
              commitments={late}
              canManage={canManage}
              onRecord={openCreateFromCommitment}
            />
          ) : null}

          {upcoming.length > 0 ? (
            <ExpectationList
              tone="upcoming"
              heading={
                relation === "future"
                  ? `Expected in ${monthName(period.month)}.`
                  : `Still expected this month.`
              }
              commitments={upcoming}
              canManage={canManage}
              onRecord={openCreateFromCommitment}
            />
          ) : null}

          <Tabs value={tab} onValueChange={(next) => next && setTab(next)}>
            <TabsList>
              <TabsTrigger value="bills">Bills</TabsTrigger>
              <TabsTrigger value="commitments">Fixed costs</TabsTrigger>
              {canManage ? <TabsTrigger value="import">Import</TabsTrigger> : null}
            </TabsList>

            <TabsContent value="bills" className="pt-3">
              <FilterBar
                search={billSearch}
                onSearch={setBillSearch}
                placeholder="Search bill, payee or category"
                shown={visibleBills.length}
                total={bills.length}
                noun="bills"
                active={billFiltersActive}
                onClear={() => {
                  setBillSearch("")
                  setBillCategory(ALL)
                  setBillOverdueOnly(false)
                }}
              >
                <FilterSelect
                  label="Category"
                  value={billCategory}
                  onChange={setBillCategory}
                  allLabel="Every category"
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
              </FilterBar>

              <BillsTable
                bills={visibleBills}
                canManage={canManage}
                onView={(id) => setCostDialog({ costId: id })}
                onPay={(id) => setPayTarget(id)}
                filtersActive={billFiltersActive}
                onCreate={openCreate}
                relation={relation}
                monthLabel={monthName(period.month)}
                isLoading={billsQuery.isPending}
                isError={billsQuery.isError}
                onRetry={() => billsQuery.refetch()}
              />
            </TabsContent>

            <TabsContent value="commitments" className="pt-3">
              <FilterBar
                search={commitmentSearch}
                onSearch={setCommitmentSearch}
                placeholder="Search label, payee or category"
                shown={visibleCommitments.length}
                total={commitments.length}
                noun="commitments"
                active={commitmentFiltersActive}
                onClear={() => {
                  setCommitmentSearch("")
                  setCommitmentStatus(ALL)
                }}
              >
                <FilterSelect
                  label="Status"
                  value={commitmentStatus}
                  onChange={setCommitmentStatus}
                  allLabel="Active and ended"
                  options={[
                    { value: "active", label: "Active only" },
                    { value: "ended", label: "Ended only" },
                  ]}
                />
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCommitmentTarget("new")}
                    className="h-9 rounded-md px-3 text-[13px] font-semibold"
                  >
                    New commitment
                  </Button>
                ) : null}
              </FilterBar>

              <CommitmentsTable
                commitments={visibleCommitments}
                canManage={canManage}
                onEdit={(c) => setCommitmentTarget(c)}
                filtersActive={commitmentFiltersActive}
                onCreate={() => setCommitmentTarget("new")}
                isLoading={commitmentsQuery.isPending}
                isError={commitmentsQuery.isError}
                onRetry={() => commitmentsQuery.refetch()}
              />
            </TabsContent>

            {canManage ? (
              <TabsContent value="import" className="pt-3">
                <ImportWizard categories={categories} onImported={invalidateAll} />
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      ) : null}

      <CostDialog
        key={costDialog ? `cost-${costDialog.costId ?? "new"}` : "cost-idle"}
        open={!!costDialog}
        onOpenChange={(next) => !next && setCostDialog(null)}
        costId={costDialog?.costId ?? null}
        period={period}
        categories={categories}
        prefill={costDialog?.prefill}
        canManage={canManage}
        onSuccess={invalidateAll}
        onPay={(id) => {
          setCostDialog(null)
          setPayTarget(id)
        }}
      />

      <PayDialog
        key={payTarget ? `pay-${payTarget}` : "pay-idle"}
        costId={payTarget}
        open={!!payTarget}
        onOpenChange={(next) => !next && setPayTarget(null)}
        period={period}
        onSuccess={() => setPayTarget(null)}
      />

      {canManage ? (
        <CommitmentDialog
          key={
            commitmentTarget === null
              ? "commitment-idle"
              : commitmentTarget === "new"
                ? "commitment-new"
                : `commitment-${commitmentTarget.id}`
          }
          commitment={commitmentTarget}
          open={!!commitmentTarget}
          onOpenChange={(next) => !next && setCommitmentTarget(null)}
          categories={categories}
          onSuccess={invalidateAll}
        />
      ) : null}
    </>
  )
}
