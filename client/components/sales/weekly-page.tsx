"use client"

/**
 * `/sales/weekly`: the Weekly Report (revision §26).
 *
 * Mostly a view. The calls, meetings, deal changes and finished tasks of the
 * week are read from where they already live and grouped into one block per
 * account per day; only Challenges, Gap and a next step for an account with
 * no deal are typed here.
 *
 * Three tabs, because the menu stays flat (§26.14): My Week, Past Weeks, and
 * All Reports for a Sales Admin. Typed boxes save when they lose focus, so the
 * page has no Save button and leaving it loses nothing.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiDownload2Line,
  RiErrorWarningLine,
  RiRefreshLine,
} from "@remixicon/react"

import {
  addWeeklyOtherWork,
  getEmployeeWeek,
  getMyWeek,
  getWeeklyCopy,
  listSalesAccounts,
  listTeamWeek,
  logCommunication,
  removeWeeklyOtherWork,
  saveWeeklyNote,
  setSoftwareNeeded,
  submitMyWeek,
} from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type { WeeklyAccountRow, WeeklyDay, WeeklyReportDetail, WeeklyTeamRow } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { CheckboxField, Field, PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { shortDay } from "@/components/sales/sales-shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

const PRIMARY = "h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const OUTLINE =
  "h-auto rounded-md border border-[#E4E9EF] bg-white px-3.5 py-2 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
const QUIET =
  "h-auto rounded-md px-3 py-1.5 text-[12px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"

const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
}

const CHANNELS = [
  ["CALL", "Call"],
  ["EMAIL", "Email"],
  ["WHATSAPP", "WhatsApp"],
  ["OTHER", "Other"],
] as const

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/** "13 Sep", for a date the server sends. */
const dayLabel = (iso: string) => shortDay(iso)

/** "Sunday 13 Sep" — the heading of a day's block. */
function bandLabel(iso: string): string {
  return `${WEEKDAYS[new Date(iso).getUTCDay()]} ${dayLabel(iso)}`
}

/**
 * The Sunday of the week a date falls in, as YYYY-MM-DD. A Saturday belongs to
 * the week it opens, exactly as the server has it (§26.2).
 */
function weekStartOf(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const weekday = utc.getUTCDay()
  const start = weekday === 6 ? new Date(utc.getTime() + 86_400_000) : new Date(utc.getTime() - weekday * 86_400_000)
  return start.toISOString().slice(0, 10)
}

const shiftWeek = (week: string, weeks: number) =>
  new Date(new Date(`${week}T00:00:00.000Z`).getTime() + weeks * 7 * 86_400_000).toISOString().slice(0, 10)

export function WeeklyPage({ tab }: { tab: "mine" | "history" | "all" }) {
  const { user, status: sessionStatus } = useSession()
  const isAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  const title = tab === "all" ? "All Reports" : tab === "history" ? "Past Weeks" : "My Week"
  const sub =
    tab === "all"
      ? "Every Sales User's week, and who has not sent theirs yet."
      : "Sunday to Thursday. What the Sales Hub already knows is filled in for you."

  return (
    <>
      <PageHeader kicker="Weekly Report" title={title} sub={sub} />
      <nav className="mb-4 flex flex-wrap gap-2">
        <TabLink href="/sales/weekly" label="My Week" active={tab === "mine"} />
        <TabLink href="/sales/weekly/history" label="Past Weeks" active={tab === "history"} />
        {isAdmin ? <TabLink href="/sales/weekly/all" label="All Reports" active={tab === "all"} /> : null}
      </nav>

      {sessionStatus === "loading" ? (
        <Skeleton className="h-48 w-full" />
      ) : tab === "all" ? (
        <TeamReports />
      ) : (
        <MyWeek history={tab === "history"} />
      )}
    </>
  )
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white"
          : "rounded-md border border-[#E4E9EF] bg-white px-3.5 py-2 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
      }
    >
      {label}
    </Link>
  )
}

// ── my week ──────────────────────────────────────────────────────────────────

function MyWeek({ history }: { history: boolean }) {
  const { accessToken, status } = useSession()
  const authed = status === "authenticated" && !!accessToken

  // Past Weeks opens on the week before this one; My Week on this one.
  const [week, setWeek] = useState<string>(() =>
    history ? shiftWeek(weekStartOf(new Date()), -1) : weekStartOf(new Date())
  )
  const query = useQuery({
    queryKey: salesKeys.weeklyMine(week),
    queryFn: () => getMyWeek(accessToken!, week),
    enabled: authed,
  })

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" className={OUTLINE} onClick={() => setWeek((w) => shiftWeek(w, -1))}>
          <RiArrowLeftSLine className="size-4" aria-hidden />
          Earlier week
        </Button>
        <Button
          type="button"
          className={OUTLINE}
          disabled={week >= weekStartOf(new Date())}
          onClick={() => setWeek((w) => shiftWeek(w, 1))}
        >
          Later week
          <RiArrowRightSLine className="size-4" aria-hidden />
        </Button>
        {week !== weekStartOf(new Date()) ? (
          <Button type="button" className={QUIET} onClick={() => setWeek(weekStartOf(new Date()))}>
            This week
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : !query.data ? (
        <>
          <PanelAlert>{toMessage(query.error)}</PanelAlert>
          <Button onClick={() => query.refetch()} className={`mt-3 ${OUTLINE}`}>
            <RiRefreshLine className="size-4" aria-hidden />
            Try again
          </Button>
        </>
      ) : (
        <WeekView week={query.data} weekKey={week} readOnly={false} />
      )}
    </>
  )
}

// ── the week itself ──────────────────────────────────────────────────────────

function WeekView({ week, weekKey, readOnly }: { week: WeeklyReportDetail; weekKey: string; readOnly: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const refresh = () => queryClient.invalidateQueries({ queryKey: salesKeys.weeklyMine(weekKey) })

  const submit = useMutation({
    mutationFn: () => submitMyWeek(accessToken!, weekKey),
    onSuccess: (blob) => {
      downloadBlob(blob, `Weekly Report – ${week.person.fullName}.pdf`)
      toast.success("Submitted. The copy is kept, and it downloaded.")
      refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const counts: Array<[number, string]> = [
    [week.counts.accounts, "Accounts worked on"],
    [week.counts.communications, "Calls and messages"],
    [week.counts.meetings, "Meetings"],
    [week.counts.dealChanges, "Deals changed"],
    [week.counts.tasksDone, "Tasks done"],
  ]

  return (
    <>
      <section className="mb-4 rounded-md border border-[#E4E9EF] bg-white px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-bold">
                {dayLabel(week.weekStart)} to {dayLabel(week.days[week.days.length - 1]?.date ?? week.weekStart)}
              </span>
              <Tag
                label={week.submittedLate ? "Submitted late" : STATUS_LABEL[week.status]}
                tone={week.status === "SUBMITTED" ? (week.submittedLate ? "yellow" : "green") : "neutral"}
              />
            </div>
            <p className={`mt-1 text-[12px] ${TONE.muted}`}>
              Due by the end of {dayLabel(week.deadlineDay)}.
              {week.lastSubmittedAt ? ` Last submitted ${shortDay(week.lastSubmittedAt)}.` : ""}
            </p>
          </div>
          {readOnly ? null : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" className={OUTLINE} onClick={() => setAddOpen(true)}>
                <RiAddLine className="size-4" aria-hidden />
                Add activity
              </Button>
              <Button
                type="button"
                className={PRIMARY}
                disabled={week.status === "NOT_STARTED" || submit.isPending}
                onClick={() => {
                  setError(null)
                  submit.mutate()
                }}
              >
                <RiDownload2Line className="size-4" aria-hidden />
                {submit.isPending ? "Submitting…" : week.status === "SUBMITTED" ? "Submit again" : "Submit"}
              </Button>
            </div>
          )}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          {counts.map(([figure, caption]) => (
            <div key={caption} className="rounded-md border-l-[3px] border-[#12A150] bg-[#F7F9FB] px-3 py-2">
              <div className="text-[15px] font-bold text-[#0B7A3B]">{figure}</div>
              <div className={`text-[10.5px] uppercase tracking-wide ${TONE.muted}`}>{caption}</div>
            </div>
          ))}
        </div>

        {week.status === "NOT_STARTED" && !readOnly ? (
          <p className={`mt-3 text-[12px] ${TONE.muted}`}>
            Nothing has been written in this week yet. Log a call, or add a line of other work, and it can be
            submitted.
          </p>
        ) : null}

        {error ? (
          <div className="mt-3">
            <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert>
          </div>
        ) : null}

        {week.copies.length > 0 ? (
          <div className="mt-3 border-t border-[#EEF1F5] pt-3">
            <span className={`text-[11.5px] font-bold uppercase tracking-wide ${TONE.muted}`}>Kept copies</span>
            <ul className="mt-1 grid gap-1">
              {week.copies.map((copy) => (
                <li key={copy.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span>{shortDay(copy.submittedAt)}</span>
                  <CopyButton copyId={copy.id} fileName={copy.fileName} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        {week.days.map((day) => (
          <DayBlock key={day.date} day={day} weekKey={weekKey} readOnly={readOnly} />
        ))}
      </div>

      {addOpen ? <AddActivityDialog weekKey={weekKey} onClose={() => setAddOpen(false)} /> : null}
    </>
  )
}

function CopyButton({ copyId, fileName }: { copyId: string; fileName: string }) {
  const { accessToken } = useSession()
  const get = useMutation({
    mutationFn: () => getWeeklyCopy(accessToken!, copyId),
    onSuccess: (blob) => downloadBlob(blob, fileName),
    onError: (err) => toast.error(toMessage(err)),
  })
  return (
    <Button type="button" className={QUIET} disabled={get.isPending} onClick={() => get.mutate()}>
      {get.isPending ? "Fetching…" : "Download"}
    </Button>
  )
}

function DayBlock({ day, weekKey, readOnly }: { day: WeeklyDay; weekKey: string; readOnly: boolean }) {
  const labelled = day.label !== null
  return (
    <section className="rounded-md border border-[#E4E9EF] bg-white">
      <div
        className={`flex items-center justify-between rounded-t-md px-3.5 py-2 text-[12.5px] font-bold ${
          labelled ? "bg-[#FDF8EE] text-[#8A5E0C]" : "bg-[#17191C] text-white"
        }`}
      >
        <span>{bandLabel(day.date)}</span>
        {day.label ? <span className="text-[11.5px] font-semibold">{day.label.text}</span> : null}
      </div>

      <div className="grid gap-3 px-3.5 py-3">
        {day.accounts.length === 0 && day.otherWork.length === 0 ? (
          <p className={`text-[12px] ${TONE.muted}`}>
            {labelled ? "The office was closed." : "Nothing recorded on this day."}
          </p>
        ) : null}

        {day.accounts.map((row) => (
          <AccountBlock key={row.salesAccountId} row={row} date={day.date} weekKey={weekKey} readOnly={readOnly} />
        ))}

        <OtherWork day={day} weekKey={weekKey} readOnly={readOnly} />
      </div>
    </section>
  )
}

function AccountBlock({
  row,
  date,
  weekKey,
  readOnly,
}: {
  row: WeeklyAccountRow
  date: string
  weekKey: string
  readOnly: boolean
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [challenges, setChallenges] = useState(row.challenges ?? "")
  const [gap, setGap] = useState(row.gap ?? "")
  const [nextStep, setNextStep] = useState(row.nextStep ?? "")
  const [makeTask, setMakeTask] = useState(false)
  const [saved, setSaved] = useState(false)

  // A save answers with the whole week, so these boxes follow the server
  // rather than keeping an older copy of their own. Worked out during
  // render, which is what React asks for instead of an effect.
  const fromServer = [row.challenges ?? "", row.gap ?? "", row.nextStep ?? ""].join(" ")
  const [seen, setSeen] = useState(fromServer)
  if (fromServer !== seen) {
    setSeen(fromServer)
    setChallenges(row.challenges ?? "")
    setGap(row.gap ?? "")
    setNextStep(row.nextStep ?? "")
  }

  const save = useMutation({
    mutationFn: (body: { challenges: string | null; gap: string | null; nextStep: string | null; makeTask: boolean }) =>
      saveWeeklyNote(accessToken!, { date: date.slice(0, 10), salesAccountId: row.salesAccountId, ...body }),
    onSuccess: () => {
      setSaved(true)
      setMakeTask(false)
      window.setTimeout(() => setSaved(false), 2000)
      queryClient.invalidateQueries({ queryKey: salesKeys.weeklyMine(weekKey) })
    },
    onError: (err) => toast.error(toMessage(err)),
  })

  const blank = (value: string) => value.trim() || null
  const commit = (over: Partial<{ challenges: string; gap: string; nextStep: string; makeTask: boolean }> = {}) =>
    save.mutate({
      challenges: blank(over.challenges ?? challenges),
      gap: blank(over.gap ?? gap),
      nextStep: blank(over.nextStep ?? nextStep),
      makeTask: over.makeTask ?? makeTask,
    })

  return (
    <div className="rounded-md border border-[#EEF1F5] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-bold">{row.accountName}</span>
        {saved ? <span className="text-[11.5px] font-bold text-[#0B7A3B]">Saved</span> : null}
      </div>

      {row.visited.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-[12px] leading-relaxed">
          {row.visited.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}

      <div className={`mt-2 text-[12px] ${TONE.muted}`}>
        <span className="font-semibold">Requirement:</span> {row.requirement}
      </div>

      {row.deals.map((deal) => (
        <div key={deal.id} className="mt-2 rounded-md bg-[#F7F9FB] px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] font-bold">{deal.name}</span>
            <SoftwareNeeded dealId={deal.id} value={deal.softwareNeeded} weekKey={weekKey} readOnly={readOnly} />
          </div>
          {deal.nextStep ? (
            <p className="mt-1 text-[12px]">
              <span className="font-semibold">Next step:</span> {deal.nextStep}
            </p>
          ) : (
            <p className={`mt-1 text-[12px] ${TONE.muted}`}>
              No next step on this deal.{" "}
              <Link href={`/sales/opportunities/${deal.id}`} className="underline">
                Set one
              </Link>
            </p>
          )}
        </div>
      ))}

      {row.pendingTasks.length > 0 ? (
        <div className="mt-2 text-[12px]">
          <span className="font-semibold">Pending tasks:</span> {row.pendingTasks.map((task) => task.title).join(", ")}
        </div>
      ) : null}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Field label="Challenges" hint="What got in your way on this account that day.">
          <Textarea
            rows={2}
            value={challenges}
            disabled={readOnly}
            onChange={(e) => setChallenges(e.target.value)}
            onBlur={() => (row.challenges ?? "") !== challenges && commit({ challenges })}
          />
        </Field>
        <Field label="Gap" hint="A shortfall on our side that cost us with this customer.">
          <Textarea
            rows={2}
            value={gap}
            disabled={readOnly}
            onChange={(e) => setGap(e.target.value)}
            onBlur={() => (row.gap ?? "") !== gap && commit({ gap })}
          />
        </Field>
      </div>

      {row.deals.length === 0 ? (
        <div className="mt-2">
          <Field label="Next step" hint="Kept here while this account has no open deal.">
            <Input
              value={nextStep}
              disabled={readOnly}
              onChange={(e) => setNextStep(e.target.value)}
              onBlur={() => (row.nextStep ?? "") !== nextStep && commit({ nextStep })}
            />
          </Field>
          {readOnly ? null : (
            <div className="mt-1">
              <CheckboxField
                label="Make it a task for me, due a week from today"
                checked={makeTask}
                onChange={(on) => {
                  setMakeTask(on)
                  if (on && nextStep.trim()) commit({ makeTask: true })
                }}
              />
            </div>
          )}
          {row.taskId ? <p className={`mt-1 text-[11.5px] ${TONE.muted}`}>A task was made from this step.</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function SoftwareNeeded({
  dealId,
  value,
  weekKey,
  readOnly,
}: {
  dealId: string
  value: boolean | null
  weekKey: string
  readOnly: boolean
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const set = useMutation({
    mutationFn: (next: boolean | null) => setSoftwareNeeded(accessToken!, dealId, next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: salesKeys.weeklyMine(weekKey) }),
    onError: (err) => toast.error(toMessage(err)),
  })

  const current = value === null ? "unanswered" : value ? "yes" : "no"

  return (
    <span className="flex items-center gap-1.5 text-[11.5px]">
      <span className={TONE.muted}>Software needed</span>
      <Select
        value={current}
        disabled={readOnly || set.isPending}
        onValueChange={(v) => v && set.mutate(v === "unanswered" ? null : v === "yes")}
      >
        <SelectTrigger aria-label="Software needed" className="h-8 w-28">
          <SelectValue>
            {(v: string | null) => ((v ?? current) === "yes" ? "Yes" : (v ?? current) === "no" ? "No" : "Not asked")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
          <SelectItem value="unanswered">Not asked</SelectItem>
        </SelectContent>
      </Select>
    </span>
  )
}

function OtherWork({ day, weekKey, readOnly }: { day: WeeklyDay; weekKey: string; readOnly: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [text, setText] = useState("")
  const refresh = () => queryClient.invalidateQueries({ queryKey: salesKeys.weeklyMine(weekKey) })

  const add = useMutation({
    mutationFn: () => addWeeklyOtherWork(accessToken!, { date: day.date.slice(0, 10), text: text.trim() }),
    onSuccess: () => {
      setText("")
      refresh()
    },
    onError: (err) => toast.error(toMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => removeWeeklyOtherWork(accessToken!, id),
    onSuccess: refresh,
    onError: (err) => toast.error(toMessage(err)),
  })

  if (readOnly && day.otherWork.length === 0) return null

  return (
    <div className="rounded-md border border-dashed border-[#E4E9EF] px-3 py-2">
      <span className={`text-[11.5px] font-bold uppercase tracking-wide ${TONE.muted}`}>Other work</span>
      {day.otherWork.length > 0 ? (
        <ul className="mt-1 grid gap-1">
          {day.otherWork.map((work) => (
            <li key={work.id} className="flex items-start justify-between gap-2 text-[12px]">
              <span>{work.text}</span>
              {readOnly ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove ${work.text}`}
                  className="h-7 w-7 shrink-0 p-0 text-[#5F6B7C] hover:bg-[#F1F4F8]"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(work.id)}
                >
                  <RiDeleteBinLine className="size-3.5" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {readOnly ? null : (
        <div className="mt-1.5 flex gap-2">
          <Input
            aria-label={`Other work on ${bandLabel(day.date)}`}
            placeholder="An office discussion, learning, an HLD…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            type="button"
            className={OUTLINE}
            disabled={!text.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  )
}

// ── add activity ─────────────────────────────────────────────────────────────

/**
 * A call or a message, logged from here and saved where it belongs: the
 * account's own Timeline (§26.6). Meetings and requirements have their own
 * forms, so this points the way there rather than repeating them.
 */
function AddActivityDialog({ weekKey, onClose }: { weekKey: string; onClose: () => void }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [salesAccountId, setAccount] = useState("")
  const [channel, setChannel] = useState<string>("CALL")
  const [summary, setSummary] = useState("")
  const [detail, setDetail] = useState("")
  const [error, setError] = useState<string | null>(null)

  const accounts = useQuery({
    queryKey: salesKeys.accounts("mine"),
    queryFn: () => listSalesAccounts(accessToken!),
    enabled: !!accessToken,
  })

  const log = useMutation({
    mutationFn: () =>
      logCommunication(accessToken!, salesAccountId, {
        channel: channel as "CALL" | "EMAIL" | "WHATSAPP" | "OTHER",
        occurredAt: new Date().toISOString(),
        summary: summary.trim(),
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: salesKeys.weeklyMine(weekKey) })
      toast.success("Logged. It is on the account's Timeline and in your week.")
      onClose()
    },
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Log a call or message</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="Account">
            <Select value={salesAccountId} onValueChange={(v) => v && setAccount(v)}>
              <SelectTrigger aria-label="Account" className="w-full">
                <SelectValue>
                  {(v: string | null) =>
                    accounts.data?.find((a) => a.id === (v ?? salesAccountId))?.name ?? "Choose an account"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(accounts.data ?? []).map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="How">
            <Select value={channel} onValueChange={(v) => v && setChannel(v)}>
              <SelectTrigger aria-label="How" className="w-full">
                <SelectValue>
                  {(v: string | null) => CHANNELS.find(([key]) => key === (v ?? channel))?.[1] ?? "Call"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CHANNELS.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="What happened">
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Asked about the quotation"
            />
          </Field>

          <Field label="More, if it matters" hint="Optional.">
            <Textarea rows={3} value={detail} onChange={(e) => setDetail(e.target.value)} />
          </Field>

          {error ? <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert> : null}

          <PanelNotice>
            A meeting or a new requirement has its own form. Open{" "}
            <Link href="/sales/meetings" className="underline">
              Meetings
            </Link>{" "}
            or{" "}
            <Link href="/sales/opportunities" className="underline">
              Opportunities
            </Link>{" "}
            and it appears in this week by itself.
          </PanelNotice>
        </div>

        <DialogFooter>
          <Button type="button" className={QUIET} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            className={PRIMARY}
            disabled={!salesAccountId || !summary.trim() || log.isPending}
            onClick={() => {
              setError(null)
              log.mutate()
            }}
          >
            {log.isPending ? "Saving…" : "Log it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── all reports ──────────────────────────────────────────────────────────────

function TeamReports() {
  const { accessToken, status } = useSession()
  const authed = status === "authenticated" && !!accessToken
  const [week, setWeek] = useState<string>(() => shiftWeek(weekStartOf(new Date()), -1))
  const [openFor, setOpenFor] = useState<WeeklyTeamRow | null>(null)

  const query = useQuery({
    queryKey: salesKeys.weeklyTeam(week),
    queryFn: () => listTeamWeek(accessToken!, week),
    enabled: authed,
  })

  const missing = useMemo(() => (query.data ?? []).filter((row) => row.status !== "SUBMITTED").length, [query.data])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" className={OUTLINE} onClick={() => setWeek((w) => shiftWeek(w, -1))}>
          <RiArrowLeftSLine className="size-4" aria-hidden />
          Earlier week
        </Button>
        <Button
          type="button"
          className={OUTLINE}
          disabled={week >= weekStartOf(new Date())}
          onClick={() => setWeek((w) => shiftWeek(w, 1))}
        >
          Later week
          <RiArrowRightSLine className="size-4" aria-hidden />
        </Button>
        <span className={`text-[12.5px] ${TONE.muted}`}>Week of {dayLabel(`${week}T00:00:00.000Z`)}</span>
      </div>

      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : !query.data ? (
        <>
          <PanelAlert>{toMessage(query.error)}</PanelAlert>
          <Button onClick={() => query.refetch()} className={`mt-3 ${OUTLINE}`}>
            <RiRefreshLine className="size-4" aria-hidden />
            Try again
          </Button>
        </>
      ) : query.data.length === 0 ? (
        <section className="rounded-md border border-[#E4E9EF] bg-white px-4 py-8 text-center">
          <RiErrorWarningLine className={`mx-auto size-5 ${TONE.muted}`} aria-hidden />
          <p className="mt-2 text-[13px] font-bold">Nobody in the hub writes a weekly report yet</p>
          <p className={`mt-1 text-[12.5px] ${TONE.muted}`}>Only Sales Users write one.</p>
        </section>
      ) : (
        <>
          <p className={`mb-2 text-[12.5px] ${TONE.muted}`}>
            {missing === 0 ? "Everybody sent that week's report." : `${missing} still to come.`}
          </p>
          <section className="overflow-x-auto rounded-md border border-[#E4E9EF] bg-white">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className={`bg-[#F7F9FB] text-left ${TONE.muted}`}>
                  <th className="px-3.5 py-2 font-semibold">Name</th>
                  <th className="px-3.5 py-2 font-semibold">Job title</th>
                  <th className="px-3.5 py-2 font-semibold">That week</th>
                  <th className="px-3.5 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {query.data.map((row) => (
                  <tr key={row.employeeId} className="border-t border-[#EEF1F5]">
                    <td className="px-3.5 py-2 font-bold">{row.fullName}</td>
                    <td className={`px-3.5 py-2 ${TONE.muted}`}>{row.designation}</td>
                    <td className="px-3.5 py-2">
                      <Tag
                        label={row.submittedLate ? "Submitted late" : STATUS_LABEL[row.status]}
                        tone={row.status === "SUBMITTED" ? (row.submittedLate ? "yellow" : "green") : "neutral"}
                      />
                    </td>
                    <td className="px-3.5 py-2 text-right">
                      <Button type="button" className={QUIET} onClick={() => setOpenFor(row)}>
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {openFor ? <EmployeeWeek row={openFor} week={week} onClose={() => setOpenFor(null)} /> : null}
    </>
  )
}

/** One person's week, read-only: an admin reads and downloads, never writes (§26.15). */
function EmployeeWeek({ row, week, onClose }: { row: WeeklyTeamRow; week: string; onClose: () => void }) {
  const { accessToken } = useSession()
  const query = useQuery({
    queryKey: salesKeys.weeklyOf(row.employeeId, week),
    queryFn: () => getEmployeeWeek(accessToken!, row.employeeId, week),
    enabled: !!accessToken,
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>
            {row.fullName} · week of {dayLabel(`${week}T00:00:00.000Z`)}
          </DialogTitle>
        </DialogHeader>

        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : !query.data ? (
          <PanelAlert>{toMessage(query.error)}</PanelAlert>
        ) : (
          <WeekView week={query.data} weekKey={week} readOnly />
        )}
      </DialogContent>
    </Dialog>
  )
}
