"use client"

/**
 * `/sales/meetings`: every meeting, grouped by day into Today, This week,
 * Later and Past (revision §24.5). A calendar grid can come later.
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiErrorWarningLine, RiInboxLine, RiRefreshLine } from "@remixicon/react"

import { listMeetings } from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type { SalesMeetingSummary } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import {
  MeetingFormDialog,
  MeetingStatusDialog,
  useMeetingStatus,
  useStartMinutes,
} from "@/components/sales/meeting-dialogs"
import { MeetingRow, meetingActions } from "@/components/sales/plan-panels"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

/** How far back Past reaches, so it is recent history and not every meeting ever held. */
const PAST_DAYS = 30
const DAY_MS = 86_400_000

function pastFrom(): string {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return new Date(start.getTime() - PAST_DAYS * DAY_MS).toISOString()
}

/** Split by the viewer's own day. Past runs newest first; the rest soonest first. */
function groupByDay(items: SalesMeetingSummary[]) {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.getTime()
  const tomorrow = today + DAY_MS
  const weekEnd = today + 7 * DAY_MS
  const at = (m: SalesMeetingSummary) => new Date(m.scheduledAt).getTime()
  return [
    { title: "Today", items: items.filter((m) => at(m) >= today && at(m) < tomorrow) },
    { title: "This week", items: items.filter((m) => at(m) >= tomorrow && at(m) < weekEnd) },
    { title: "Later", items: items.filter((m) => at(m) >= weekEnd) },
    {
      title: `Past ${PAST_DAYS} days`,
      items: items.filter((m) => at(m) < today).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)),
    },
  ].filter((group) => group.items.length > 0)
}

const TOGGLE_ON = "h-9 rounded-md bg-[#17191C] px-3 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const TOGGLE_OFF =
  "h-9 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"

export function MeetingsPage({ initialMine }: { initialMine: boolean | null }) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  // A Sales User starts on their own meetings; a Sales Admin on everybody's.
  const [mineChoice, setMine] = useState<boolean | null>(initialMine)
  const mine = mineChoice ?? !isSalesAdmin
  const [showCancelled, setShowCancelled] = useState(false)
  const [from] = useState(pastFrom)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [editing, setEditing] = useState<SalesMeetingSummary | null>(null)
  const [ending, setEnding] = useState<{ meeting: SalesMeetingSummary; action: "COMPLETED" | "CANCELLED" } | null>(null)
  const putBack = useMeetingStatus()
  const startMinutes = useStartMinutes()

  const filters = { ...(mine ? { mine: true } : {}), from }
  const query = useQuery({
    queryKey: salesKeys.meetings(filters),
    queryFn: () => listMeetings(accessToken!, filters),
    enabled: isAuthed,
  })

  const isLoading = sessionStatus === "loading" || query.isPending
  const all = query.data?.items ?? []
  const visible = showCancelled ? all : all.filter((m) => m.status !== "CANCELLED")
  const groups = groupByDay(visible)
  const hiddenCancelled = all.length - visible.length

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Meetings"
        sub="Visits, meetings at our office and online calls, by day. Everyone attending on our side gets them in the 00:01 email."
        cta="Schedule a meeting"
        onCta={() => setScheduleOpen(true)}
      />

      {/* Hidden while loading: a filter beside a skeleton reads as an answer
          about a list nobody has counted yet. */}
      {!isLoading && !query.isError ? (
        <section className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[#E4E9EF] bg-white p-3 sm:p-4">
          <Button type="button" aria-pressed={mine} onClick={() => setMine(!mine)} className={mine ? TOGGLE_ON : TOGGLE_OFF}>
            Mine only
          </Button>
          <Button
            type="button"
            aria-pressed={showCancelled}
            onClick={() => setShowCancelled(!showCancelled)}
            className={showCancelled ? TOGGLE_ON : TOGGLE_OFF}
          >
            Show cancelled
          </Button>
          <span className={`text-[12px] ${TONE.muted}`}>
            {mine ? "Meetings you attend on our side" : "Every meeting in the hub"}
            {!showCancelled && hiddenCancelled > 0 ? `, ${hiddenCancelled} cancelled hidden` : ""}
          </span>
        </section>
      ) : null}

      {startMinutes.error ? (
        <div className="mb-3">
          <PanelAlert onDismiss={() => startMinutes.reset()}>{toMessage(startMinutes.error)}</PanelAlert>
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5 py-5">
          <Skeleton className="h-4 w-24" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ) : query.isError ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-[#E4E9EF] bg-white px-5 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          <div className="text-[13.5px] font-bold">Meetings could not be loaded</div>
          <p className={`text-[12.5px] ${TONE.muted}`}>Nothing has changed. Check the connection and try again.</p>
          <Button
            onClick={() => query.refetch()}
            className="h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
          >
            <RiRefreshLine className="size-4" aria-hidden />
            Retry
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-[#E4E9EF] bg-white px-5 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-md bg-[#F1F4F8] text-[#5F6B7C]">
            <RiInboxLine className="size-5" aria-hidden />
          </span>
          <div className="text-[13.5px] font-bold">{mine ? "No meetings for you" : "No meetings yet"}</div>
          <p className={`max-w-[46ch] text-[12.5px] leading-relaxed ${TONE.muted}`}>
            {mine
              ? `Nothing coming up, and nothing in the past ${PAST_DAYS} days, that you attend on our side.`
              : `Nothing coming up, and nothing in the past ${PAST_DAYS} days. Schedule one from here or from an account.`}
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {groups.map((group) => (
            <section
              key={group.title}
              className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5"
            >
              <h2 className="mb-1 text-[13.5px] font-bold">
                {group.title} <span className={`font-semibold ${TONE.muted}`}>· {group.items.length}</span>
              </h2>
              <ul>
                {group.items.map((meeting, i) => (
                  <MeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    showAccount
                    delayMs={Math.min(i, 6) * 40}
                    actions={meetingActions(meeting, {
                      onEdit: () => setEditing(meeting),
                      onComplete: () => setEnding({ meeting, action: "COMPLETED" }),
                      onCancel: () => setEnding({ meeting, action: "CANCELLED" }),
                      onPutBack: () => putBack.mutate({ id: meeting.id, body: { status: "SCHEDULED" } }),
                      onWriteMinutes: () => startMinutes.mutate(meeting.id),
                    })}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <MeetingFormDialog open={scheduleOpen} onOpenChange={setScheduleOpen} />
      <MeetingFormDialog
        open={!!editing}
        onOpenChange={(open) => (open ? undefined : setEditing(null))}
        meeting={editing ?? undefined}
      />
      <MeetingStatusDialog
        meeting={ending?.meeting ?? null}
        action={ending?.action ?? null}
        onClose={() => setEnding(null)}
      />
    </>
  )
}
