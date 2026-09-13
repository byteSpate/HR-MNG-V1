"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiArrowRightLine,
  RiCalendarEventLine,
  RiErrorWarningLine,
  RiHourglassLine,
  RiUserSearchLine,
  RiZzzLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import { getSalesDashboard, getSalesTargetYear, setSalesTarget } from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type {
  DashboardStat,
  SalesActionRow,
  SalesTargetQuarter,
  SalesTargetYear,
  SalesTeamRow,
  SetSalesTargetBody,
} from "@/lib/api/types"
import { tones, type Stat } from "@/components/dashboard/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { StatCard } from "@/components/dashboard/stat-card"
import {
  Field,
  FormError,
  PanelAlert,
  PanelNotice,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { taka } from "@/components/sales/sales-shared"

/** The server's own rule, checked here too so the answer arrives before a round trip. */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/

/**
 * The server's `trend` is the client's `bars`. Absent stays absent: no sales
 * stat has stored history, and a row of zeros would be indistinguishable from
 * a real series.
 */
const toStat = (s: DashboardStat): Stat => ({
  label: s.label,
  value: s.value,
  sub: s.sub,
  tag: s.tag,
  tone: s.tone,
  bars: s.trend,
  hotBar: s.hotBar,
  href: s.href,
  failed: s.failed,
  icon: s.icon,
})

/**
 * Consecutive stats that share a `group` become one labelled row. The server
 * decides the grouping and its order; the page only draws it.
 */
function groupStats(stats: DashboardStat[]): { title: string | null; stats: DashboardStat[] }[] {
  const groups: { title: string | null; stats: DashboardStat[] }[] = []
  for (const stat of stats) {
    const title = stat.group ?? null
    const last = groups.at(-1)
    if (last && last.title === title) last.stats.push(stat)
    else groups.push({ title, stats: [stat] })
  }
  return groups
}

/** One picture per action row, keyed by the row's own `key`. Unknown keys get none. */
const ACTION_ICON: Record<string, RemixiconComponentType> = {
  closing: RiCalendarEventLine,
  unverified: RiUserSearchLine,
  quiet: RiZzzLine,
  stuck: RiHourglassLine,
}

/** Capped at six, as the house motion rule requires: row forty must not wait. */
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 6) * 40}ms` })

function Band({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2.5">
        <h2 className="font-heading text-[15px] font-bold tracking-tight">{title}</h2>
        {sub ? <p className={`mt-0.5 text-[12.5px] ${TONE.muted}`}>{sub}</p> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * What a quarter's gap says. The server sends target minus won; whether a
 * shortfall is final depends on whether the quarter is over, so an ended
 * quarter is "short by" and a running one still has money "to go".
 */
function resultOf(q: SalesTargetQuarter): { text: string; className: string } {
  if (q.target === null || q.gap === null || q.phase === "upcoming") {
    return { text: "—", className: TONE.muted }
  }
  const gap = Number(q.gap)
  if (gap > 0) {
    return q.phase === "ended"
      ? { text: `Short by ${taka(q.gap)}`, className: TONE.danger }
      : { text: `${taka(q.gap)} to go`, className: "" }
  }
  if (gap < 0) return { text: `Ahead by ${taka(String(-gap))}`, className: "font-semibold" }
  return { text: "On target", className: "font-semibold" }
}

function QuarterTable({ quarters }: { quarters: SalesTargetQuarter[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[#E4E9EF] bg-white">
      <table className="w-full min-w-[36rem] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-[#E4E9EF] text-left">
            <th className={`px-4 py-2.5 font-semibold ${TONE.muted}`}>Quarter</th>
            <th className={`px-4 py-2.5 font-semibold ${TONE.muted}`}>Target</th>
            <th className={`px-4 py-2.5 text-right font-semibold ${TONE.muted}`}>Won</th>
            <th className={`px-4 py-2.5 font-semibold ${TONE.muted}`}>Result</th>
            <th className={`px-4 py-2.5 text-right font-semibold ${TONE.muted}`}>Deals</th>
          </tr>
        </thead>
        <tbody>
          {quarters.map((q, i) => {
            const result = resultOf(q)
            const carried = q.carried !== null && Number(q.carried) > 0 ? q.carried : null
            // A quarter that has not started has won nothing yet — that is not
            // the same fact as a quarter that ended with nothing, so it is a dash.
            const upcoming = q.phase === "upcoming"
            return (
              <tr
                key={q.quarter}
                className="rise-in border-b border-[#EEF1F5] align-top last:border-b-0 motion-reduce:animate-none"
                style={stagger(i)}
              >
                <td className="px-4 py-2.5 font-semibold">Q{q.quarter}</td>
                {/* A dash, never ৳0. Nobody deciding is a different fact
                    from somebody deciding none. */}
                <td className="px-4 py-2.5">
                  {q.target === null ? (
                    <span className={TONE.muted}>—</span>
                  ) : (
                    <>
                      <div className="tabular-nums">{taka(q.target)}</div>
                      {carried ? (
                        <div className={`text-[11.5px] ${TONE.muted}`}>
                          includes {taka(carried)} carried from Q{q.quarter - 1}
                        </div>
                      ) : q.carryPending ? (
                        <div className={`text-[11.5px] ${TONE.muted}`}>
                          plus any shortfall from Q{q.quarter - 1}
                        </div>
                      ) : null}
                    </>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {upcoming ? (
                    <span className={TONE.muted}>—</span>
                  ) : (
                    <>
                      <div>{taka(q.valueWon)}</div>
                      {q.unpricedWonCount > 0 ? (
                        <div className={`text-[11.5px] ${TONE.muted}`}>
                          {q.unpricedWonCount} with no price yet
                        </div>
                      ) : null}
                    </>
                  )}
                </td>
                <td className={`px-4 py-2.5 ${result.className}`}>{result.text}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${upcoming ? TONE.muted : ""}`}>
                  {upcoming ? "—" : q.dealsWon}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ActionRows({ rows, scope, employeeId }: { rows: SalesActionRow[]; scope: "me" | "employee" | "all"; employeeId: string | null }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {rows.map((row, i) => (
        <Link
          key={row.key}
          href={`/sales${
            scope === "all"
              ? row.href
              : row.href.startsWith("/opportunities")
                ? `${row.href}&${scope === "me" ? "mine=true" : `ownerEmployeeId=${employeeId}`}`
                : `${row.href}&ownerEmployeeId=${employeeId}`
          }`}
          style={stagger(i)}
          className="rise-in group flex items-center justify-between gap-3 rounded-md border border-[#E4E9EF] bg-white px-4 py-3 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-[#CBD5E1] hover:shadow-[0_2px_10px_rgba(16,24,40,0.06)] motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0"
        >
          <div className="flex min-w-0 items-center gap-3">
            {ACTION_ICON[row.key]
              ? (() => {
                  const Icon = ACTION_ICON[row.key]
                  // The server already chose this row's tone from its count;
                  // the icon wears it, so a row needing attention shows it.
                  return (
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-md"
                      style={{ background: tones[row.tone].bg, color: tones[row.tone].color }}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                  )
                })()
              : null}
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{row.label}</div>
              <div className={`mt-0.5 text-[11.5px] ${TONE.muted}`}>{row.detail}</div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[17px] font-bold tabular-nums" style={{ color: tones[row.tone].color }}>
              {row.count}
            </span>
            <RiArrowRightLine
              className="size-3.5 text-[#8A94A2] transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
              aria-hidden
            />
          </div>
        </Link>
      ))}
    </div>
  )
}

function TeamTable({ team, onReview }: { team: SalesTeamRow[]; onReview: (employeeId: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[#E4E9EF] bg-white">
      <table className="w-full min-w-[34rem] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-[#E4E9EF] text-left">
            <th className={`px-4 py-2.5 font-semibold ${TONE.muted}`}>Person</th>
            <th className={`px-4 py-2.5 font-semibold ${TONE.muted}`}>Target</th>
            <th className={`px-4 py-2.5 text-right font-semibold ${TONE.muted}`}>Won</th>
            <th className={`px-4 py-2.5 text-right font-semibold ${TONE.muted}`}>Deals</th>
            <th className={`px-4 py-2.5 text-right font-semibold ${TONE.muted}`}>Ongoing</th>
            <th className="px-4 py-2.5" aria-label="Review" />
          </tr>
        </thead>
        <tbody>
          {team.map((row, i) => (
            <tr
              key={row.employeeId}
              className="rise-in border-b border-[#EEF1F5] last:border-b-0 motion-reduce:animate-none"
              style={stagger(i)}
            >
              {/* Every row names the person it is about. */}
              <td className="px-4 py-2.5 font-semibold">{row.employeeName}</td>
              <td className={`px-4 py-2.5 tabular-nums ${row.target === null ? TONE.muted : ""}`}>
                {row.target === null ? "Not set" : taka(row.target)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">{taka(row.valueWon)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{row.dealsWon}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{row.ongoing}</td>
              <td className="px-4 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => onReview(row.employeeId)}
                  className="rounded-md px-2 py-1 text-[12px] font-semibold text-[#5F6B7C] transition-colors hover:bg-[#F1F4F8] hover:text-[#1C2733] focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none"
                >
                  Review
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScopeBar({
  isSalesAdmin,
  selectedEmployeeId,
  team,
  data,
  onSelect,
  onSetTarget,
}: {
  isSalesAdmin: boolean
  selectedEmployeeId: string
  team: SalesTeamRow[]
  data: { scope: "me" | "employee" | "all"; employeeName: string | null }
  onSelect: (employeeId: string) => void
  onSetTarget: () => void
}) {
  const scopeDescription =
    data.scope === "all"
      ? "Team pipeline and shared priorities"
      : data.scope === "employee"
        ? `Individual pipeline for ${data.employeeName}`
        : "Your accounts and shared priorities"

  return (
    <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-y border-[#E4E9EF] py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {isSalesAdmin ? (
            <Select value={selectedEmployeeId} onValueChange={(value) => onSelect(value ?? "all")}>
              <SelectTrigger aria-label="Dashboard scope" className="h-8 min-w-[12.5rem] border-0 bg-[#F7F9FB] text-[12.5px] font-bold shadow-none hover:bg-[#F1F4F8]">
                <SelectValue>
                  {(value: string | null) =>
                    value === "all"
                      ? "Everyone"
                      : team.find((person) => person.employeeId === value)?.employeeName ?? "Sales employee"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                {team.map((person) => (
                  <SelectItem key={person.employeeId} value={person.employeeId}>{person.employeeName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-[12.5px] font-bold">My sales view</span>
          )}
          <span className={`text-[12px] ${TONE.muted}`}>{scopeDescription}</span>
        </div>
      </div>
      {isSalesAdmin && data.scope !== "all" && data.employeeName ? (
        <Button
          type="button"
          onClick={onSetTarget}
          className="h-8 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
        >
          Set yearly target
        </Button>
      ) : null}
    </div>
  )
}

function TargetEditor({
  employeeId,
  employeeName,
  calendarYear,
  open,
  onOpenChange,
}: {
  employeeId: string
  employeeName: string
  calendarYear: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { accessToken } = useSession()

  const yearQuery = useQuery({
    queryKey: salesKeys.targets(calendarYear, employeeId),
    queryFn: () => getSalesTargetYear(accessToken!, calendarYear, employeeId),
    enabled: !!accessToken && open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Wider than the default dialog: the five-column quarter table needs
          36rem, and in the default width it scrolled sideways and hid the
          Result and Deals columns. */}
      <DialogContent className="sm:max-w-[42rem]">
        <DialogHeader>
          <DialogTitle>
            Yearly target — {employeeName}, {calendarYear}
          </DialogTitle>
        </DialogHeader>

        <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>
          A target is an amount of deal value, in taka, for the year. It is split equally over the
          quarters from the one it starts in. If a quarter falls short, the shortfall is added to the
          next quarter. Winning more than a quarter&rsquo;s target does not lower the next one.
        </p>

        {yearQuery.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : yearQuery.isError ? (
          <PanelAlert>{toMessage(yearQuery.error)}</PanelAlert>
        ) : (
          <>
            <QuarterTable quarters={yearQuery.data.quarters} />
            {/* Keyed by what is saved, so the fields start from the stored
                target and refill after each save. */}
            <TargetForm
              key={`${yearQuery.data.yearlyTarget ?? "none"}-${yearQuery.data.startQuarter ?? 1}`}
              employeeId={employeeId}
              calendarYear={calendarYear}
              year={yearQuery.data}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TargetForm({
  employeeId,
  calendarYear,
  year,
}: {
  employeeId: string
  calendarYear: number
  year: SalesTargetYear
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState(year.yearlyTarget ?? "")
  const [startQuarter, setStartQuarter] = useState(String(year.startQuarter ?? 1))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (body: SetSalesTargetBody) => setSalesTarget(accessToken!, body),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: salesKeys.targets(calendarYear, employeeId) })
      queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] })
    },
    // Verbatim: the server's refusal says which rule was broken.
    onError: (err) => setError(toMessage(err)),
  })

  function handleSave() {
    // Commas are how people write taka; the server wants digits.
    const clean = amount.replace(/[,\s]/g, "")
    if (!MONEY.test(clean) || Number(clean) <= 0) {
      setError("Enter the yearly target in taka, more than 0 — for example 4000000 or 40,00,000.")
      return
    }
    setError(null)
    save.mutate({ employeeId, calendarYear, amount: clean, startQuarter: Number(startQuarter) })
  }

  return (
    <>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Yearly target (৳)"
          htmlFor="target-amount"
          help="The deal value to win in the year, in taka. Commas are fine."
        >
          <Input
            id="target-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field
          label="Starts in"
          help="The target is split over this quarter and the ones after it. Choose a later quarter for somebody who joined during the year."
        >
          <Select value={startQuarter} onValueChange={(v) => setStartQuarter(v ?? "1")}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string | null) => `Q${v ?? "1"}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {["1", "2", "3", "4"].map((q) => (
                <SelectItem key={q} value={q}>
                  Q{q}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <DialogFooter>
        <Button
          type="button"
          disabled={save.isPending || !amount.trim()}
          onClick={handleSave}
          className="h-9 rounded-md bg-[#17191C] px-3.5 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
        >
          {save.isPending ? "Saving…" : "Set target"}
        </Button>
      </DialogFooter>
    </>
  )
}

export function SalesDashboard() {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  // An admin's default view is the team (§7). Everybody else only ever has one.
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("all")
  const [targetsOpen, setTargetsOpen] = useState(false)

  const employeeId = isSalesAdmin ? selectedEmployeeId : undefined
  const teamQuery = useQuery({
    queryKey: salesKeys.dashboard("all"),
    queryFn: () => getSalesDashboard(accessToken!, "all"),
    enabled: isAuthed && isSalesAdmin,
  })
  const query = useQuery({
    queryKey: salesKeys.dashboard(employeeId),
    queryFn: () => getSalesDashboard(accessToken!, employeeId),
    enabled: isAuthed,
  })

  const data = query.data

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Techno Sales Hub"
        sub={
          isSalesAdmin
            ? "The team's quarter, with a direct path into each person's work."
            : "Your quarter, and what needs doing across the accounts you work."
        }
      />

      {sessionStatus === "loading" || query.isPending ? (
        <div className="mt-5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <div className="mt-5 rounded-md border border-[#E4E9EF] bg-white px-5.5 py-8 text-center">
          <span className="mx-auto mb-2.5 flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          <p className="text-[13px] font-semibold text-[#B03A3A]">{toMessage(query.error)}</p>
          <Button
            type="button"
            onClick={() => query.refetch()}
            className="mt-3 h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            Try again
          </Button>
        </div>
      ) : data ? (
        <>
          <ScopeBar
            isSalesAdmin={isSalesAdmin}
            selectedEmployeeId={selectedEmployeeId}
            team={teamQuery.data?.team ?? []}
            data={data}
            onSelect={setSelectedEmployeeId}
            onSetTarget={() => setTargetsOpen(true)}
          />
          <Band
            title={
              data.scope === "all"
                ? "The team this quarter and year"
                : data.scope === "employee"
                  ? `${data.employeeName}'s quarter and year`
                  : "My quarter and year"
            }
            sub={`Q${data.quarter} ${data.calendarYear}`}
          >
            <div className="space-y-4">
              {groupStats(data.stats).map((group, g) => (
                <div key={group.title ?? g}>
                  {group.title ? (
                    <h3 className={`mb-2 text-[12.5px] font-semibold ${TONE.muted}`}>{group.title}</h3>
                  ) : null}
                  {/* auto-fit at xl, so a group of three fills its row and a
                      group of five does not leave one tile alone on the next. */}
                  <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
                    {group.stats.map((stat, i) => (
                      <div key={stat.label} className="rise-in motion-reduce:animate-none" style={stagger(i)}>
                        <StatCard stat={toStat(stat)} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Band>

          {data.quarters.length > 0 ? (
            <Band title="Quarter by quarter">
              <QuarterTable quarters={data.quarters} />
              {/* Stated on the page, as the design requires: the figures are
                  live rather than frozen at quarter end, because freezing them
                  would hide a correction. */}
              <p className={`mt-2 text-[11.5px] ${TONE.muted}`}>
                Achievement is counted live. Reopening a won deal moves a past quarter&rsquo;s
                figure, and the targets after it through the carry, and the audit log records why.
              </p>
            </Band>
          ) : null}

          {data.team && data.team.length > 0 ? (
            <Band
              title="Everyone"
              sub="Each person's quarter: the target with any shortfall carried in, and what they won."
            >
              <TeamTable team={data.team} onReview={setSelectedEmployeeId} />
            </Band>
          ) : null}

          <Band title="What needs doing">
            <ActionRows rows={data.actions} scope={data.scope} employeeId={data.employeeId} />
            {/* Named rather than rendered as empty rows. An empty "Tasks due"
                row reads as "no tasks", which is a number nobody measured. */}
            {data.notBuilt.length > 0 ? (
              <div className="mt-2.5">
                <PanelNotice>
                  {data.notBuilt.map((item) => item === "meetings" ? "Meetings" : item === "tasks" ? "Tasks" : item).join(" and ")} are not built yet, so this page cannot show what is due today or overdue. They arrive with Phase 3.
                </PanelNotice>
              </div>
            ) : null}
          </Band>

          {/* Hidden from a Sales User rather than disabled: a target somebody
              sets for themselves is not a target, so the control is not theirs
              to see. */}
          {isSalesAdmin && data.employeeId ? (
            <TargetEditor
              employeeId={data.employeeId}
              employeeName={data.employeeName}
              calendarYear={data.calendarYear}
              open={targetsOpen}
              onOpenChange={setTargetsOpen}
            />
          ) : null}
        </>
      ) : null}
    </>
  )
}
