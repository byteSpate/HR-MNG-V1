"use client"

/**
 * `/sales/meetings/minutes`: the Meeting Minutes page (revision §25.28).
 *
 * At the top, the meetings still waiting for their minutes (§25.29): the same
 * rule as the overview's row and the menu badge. Below, every minutes document
 * the viewer may read, with Mine only and a status filter.
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { RiErrorWarningLine, RiFilterOffLine, RiRefreshLine } from "@remixicon/react"

import { listMeetingsWaitingForMinutes, listMinutes } from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type { SalesMeetingSummary, SalesMinutesStatus } from "@/lib/api/types"
import type { TableCell } from "@/components/dashboard/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, PanelTable, RowActions, TONE, toMessage } from "@/components/dashboard/record-kit"
import { useStartMinutes } from "@/components/sales/meetings/meeting-dialogs"
import {
  MINUTES_ICON,
  MINUTES_STATUS_LABEL,
  MINUTES_STATUS_TONE,
  MEETING_MODE_LABEL,
  meetingWhen,
  shortDay,
} from "@/components/sales/shared/sales-shared"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

const STATUSES = Object.keys(MINUTES_STATUS_LABEL) as SalesMinutesStatus[]
/** A select's "any", since an empty value reads as nothing chosen at all. */
const ANY = "any"
/** The server's window for "waiting", said in the copy. */
const WAITING_DAYS = 7

const TOGGLE_ON = "h-9 rounded-md bg-[#17191C] px-3 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const TOGGLE_OFF =
  "h-9 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"

/** "13 Sep 2026", in the viewer's calendar. */
const dayWithYear = (iso: string) => `${shortDay(iso)} ${new Date(iso).getFullYear()}`

export function MinutesListPage({ initialMine }: { initialMine: boolean | null }) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  // A Sales User starts on their own; a Sales Admin on everybody's.
  const [mineChoice, setMine] = useState<boolean | null>(initialMine)
  const mine = mineChoice ?? !isSalesAdmin
  const [status, setStatus] = useState<SalesMinutesStatus | "">("")
  const startMinutes = useStartMinutes()

  const waiting = useQuery({
    queryKey: salesKeys.minutesWaiting(mine),
    queryFn: () => listMeetingsWaitingForMinutes(accessToken!, mine),
    enabled: isAuthed,
  })
  const filters = useMemo(() => ({ ...(mine ? { mine: true } : {}), ...(status ? { status } : {}) }), [mine, status])
  const list = useQuery({
    queryKey: salesKeys.minutesList(filters),
    queryFn: () => listMinutes(accessToken!, filters),
    enabled: isAuthed,
  })

  const isLoading = sessionStatus === "loading" || list.isPending
  const isFiltered = Boolean(status)

  const rows: TableCell[][] = (list.data?.items ?? []).map((item) => [
    { node: <span className="tabular-nums">{dayWithYear(item.scheduledAt)}</span> },
    { node: <span className="block truncate font-semibold">{item.meetingTitle}</span> },
    {
      node: (
        <Link href={`/sales/accounts/${item.salesAccountId}`} className="block truncate hover:underline">
          {item.salesAccountName}
        </Link>
      ),
    },
    {
      node:
        item.preparedBy.length > 0 ? (
          <span className="block truncate">{item.preparedBy.join(", ")}</span>
        ) : (
          <span className={TONE.muted}>Nobody yet</span>
        ),
    },
    {
      tag:
        item.status === "SENT" && item.lastSentAt
          ? `Sent ${shortDay(item.lastSentAt)}`
          : MINUTES_STATUS_LABEL[item.status],
      tone: MINUTES_STATUS_TONE[item.status],
    },
    {
      node: <RowActions actions={[{ kind: "link", label: "Open", href: `/sales/meetings/minutes/${item.id}` }]} />,
    },
  ])

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Meeting Minutes"
        sub="The written record of each meeting, which you send the customer. Minutes are written once a meeting is marked completed."
      />

      {startMinutes.error ? (
        <div className="mb-3">
          <PanelAlert onDismiss={() => startMinutes.reset()}>{toMessage(startMinutes.error)}</PanelAlert>
        </div>
      ) : null}

      <WaitingForMinutes
        items={waiting.data?.items}
        isLoading={sessionStatus === "loading" || waiting.isPending}
        isError={waiting.isError}
        onRetry={() => waiting.refetch()}
        mine={mine}
        pendingId={startMinutes.isPending ? startMinutes.variables : undefined}
        onWrite={(meeting) => startMinutes.mutate(meeting.id)}
      />

      <h2 className="mt-5 mb-2.5 font-heading text-[15px] font-bold tracking-tight">All minutes</h2>

      {/* Hidden while loading: a filter beside a skeleton reads as an answer
          about a list nobody has counted yet. */}
      {!isLoading && !list.isError ? (
        <section className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[#E4E9EF] bg-white p-3 sm:p-4">
          <Button type="button" aria-pressed={mine} onClick={() => setMine(!mine)} className={mine ? TOGGLE_ON : TOGGLE_OFF}>
            Mine only
          </Button>
          <Select value={status || ANY} onValueChange={(v) => setStatus(!v || v === ANY ? "" : (v as SalesMinutesStatus))}>
            <SelectTrigger aria-label="Status" className="h-9 w-52">
              <SelectValue>
                {(v: string | null) => (!v || v === ANY ? "Any status" : MINUTES_STATUS_LABEL[v as SalesMinutesStatus])}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any status</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {MINUTES_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className={`text-[12px] ${TONE.muted}`}>
            {mine ? "Minutes you started or are named on" : "Minutes on every account you can read"}
          </span>
        </section>
      ) : null}

      <PanelTable
        cols="110px minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr) 150px 90px"
        headers={["Meeting date", "Meeting", "Account", "Prepared by", "Status", ""]}
        rows={rows}
        isLoading={isLoading}
        isError={list.isError}
        onRetry={() => list.refetch()}
        emptyTitle={isFiltered ? "No minutes with that status" : mine ? "No minutes of yours yet" : "No minutes yet"}
        emptyBody={
          isFiltered
            ? "Nothing matches this filter. Show every status to see the rest."
            : "Minutes appear here once somebody starts them from a completed meeting."
        }
        emptyAction={isFiltered ? "Show every status" : undefined}
        emptyActionIcon={<RiFilterOffLine className="size-4" aria-hidden />}
        onEmptyAction={() => setStatus("")}
      />
    </>
  )
}

/** The top of the page: completed meetings from the last 7 days with no minutes (§25.29). */
function WaitingForMinutes({
  items,
  isLoading,
  isError,
  onRetry,
  mine,
  pendingId,
  onWrite,
}: {
  items: SalesMeetingSummary[] | undefined
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  mine: boolean
  pendingId: string | undefined
  onWrite: (meeting: SalesMeetingSummary) => void
}) {
  return (
    <section className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
      <h2 className="text-[13.5px] font-bold">
        Waiting for minutes
        {items && items.length > 0 ? <span className={`font-semibold ${TONE.muted}`}> · {items.length}</span> : null}
      </h2>
      <p className={`mt-0.5 text-[12px] ${TONE.muted}`}>
        Meetings completed in the last {WAITING_DAYS} days that nobody has started minutes for
        {mine ? ", where you were there for us." : "."}
      </p>

      {isLoading ? (
        <div className="mt-3 space-y-3">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ) : isError ? (
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#B03A3A]">
            <RiErrorWarningLine className="size-4" aria-hidden />
            This list could not be loaded.
          </span>
          <Button
            onClick={onRetry}
            className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            <RiRefreshLine className="size-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      ) : !items || items.length === 0 ? (
        <p className="mt-3 text-[12.5px] leading-relaxed text-[#3D4756]">
          Nothing waiting. Every meeting {mine ? "you attended" : "held"} in the last {WAITING_DAYS} days has its
          minutes started.
        </p>
      ) : (
        <ul className="mt-2">
          {items.map((meeting, i) => (
            <li
              key={meeting.id}
              className="rise-in flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF1F5] py-3 last:border-b-0 motion-reduce:animate-none"
              style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}
            >
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#F1F4F8] text-[#33373D]">
                  <MINUTES_ICON className="size-3" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[#1C2733]">{meeting.title}</div>
                  <div className="mt-0.5 text-[11.5px] text-[#5F6B7C]">
                    {[meetingWhen(meeting.scheduledAt), MEETING_MODE_LABEL[meeting.mode]].join(" · ")}
                    {" · "}
                    <Link href={`/sales/accounts/${meeting.salesAccountId}`} className="font-semibold hover:underline">
                      {meeting.salesAccountName}
                    </Link>
                  </div>
                </div>
              </div>
              {meeting.canManage ? (
                <Button
                  onClick={() => onWrite(meeting)}
                  disabled={pendingId !== undefined}
                  className="h-auto rounded-md bg-[#17191C] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
                >
                  {pendingId === meeting.id ? "Opening…" : "Write the minutes"}
                </Button>
              ) : (
                <span className={`text-[12px] ${TONE.muted}`}>Written by the people who work this account</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
