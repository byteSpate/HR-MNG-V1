"use client"

import { useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiErrorWarningLine, RiRefreshLine } from "@remixicon/react"

import { checkIn as checkInApi, checkOut as checkOutApi } from "@/lib/api/attendance"
import { ApiError } from "@/lib/api/client"
import { getDashboard } from "@/lib/api/dashboard"
import { useSession } from "@/lib/auth/session-context"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { ChartCard } from "@/components/dashboard/chart-card"
import { DataTable } from "@/components/dashboard/data-table"
import { HeroBanner, HERO_OVERLAP_PX } from "@/components/dashboard/hero-banner"
import { StatsGrid } from "@/components/dashboard/stat-card"
import { TimeClockCard } from "@/components/dashboard/time-clock-card"
import { HubEntryCard } from "@/components/sales/hub-entry-card"
import type { Stat } from "@/components/dashboard/types"
import type { DashboardStat, Role } from "@/lib/api/types"

/**
 * Role → route group, the 1:1 mapping the app router already uses.
 *
 * Spelled out rather than derived from the role string: `SUPER_ADMIN` maps to
 * `/admin` and `FINANCE_OFFICER` to `/finance`, so any transformation clever
 * enough to cover both would be one nobody could read.
 */
const ROUTE_GROUP: Record<Role, string> = {
  SUPER_ADMIN: "/admin",
  HR_ADMIN: "/hr",
  FINANCE_OFFICER: "/finance",
  REPORTING_MANAGER: "/manager",
  EMPLOYEE: "/employee",
}

/** The server's `trend` is the client's `bars`; the rest passes straight through. */
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
})

/** Matches the real grid's dimensions, so the page does not jump on load. */
function DashboardSkeleton() {
  return (
    <>
      <Skeleton className="h-40 rounded-b-md" />
      <div
        className="relative z-10 grid grid-cols-[repeat(auto-fit,minmax(215px,1fr))] gap-4"
        style={{ marginTop: -HERO_OVERLAP_PX }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-31 rounded-md" />
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
        <Skeleton className="h-63 rounded-md" />
        <Skeleton className="h-63 rounded-md" />
      </div>
    </>
  )
}

/**
 * The panels, in two columns of fixed intent.
 *
 * This was a `flex-wrap` row whose children carried hand-tuned bases
 * (`flex-[10_1_460px]`, `max-w-100 min-w-0 flex-1`). Four of them are
 * optional and which ones appear depends on the role, so the wrap points
 * differed per role and no single set of bases was right for all of them.
 *
 * Splitting by intent instead of by basis makes it deterministic: the narrow
 * column takes the two fixed-size panels, the wide column takes the two that
 * want room. Whichever side is empty collapses rather than leaving a hole.
 */
function PanelGrid({ narrow, wide }: { narrow: ReactNode[]; wide: ReactNode[] }) {
  if (narrow.length === 0 && wide.length === 0) return null

  const twoUp = narrow.length > 0 && wide.length > 0

  return (
    <div
      className={
        twoUp
          ? "mt-6 grid items-start gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]"
          : "mt-6 grid items-start gap-4"
      }
    >
      {narrow.length > 0 ? <div className="grid gap-4">{narrow}</div> : null}
      {wide.length > 0 ? <div className="grid min-w-0 gap-4">{wide}</div> : null}
    </div>
  )
}

/**
 * One component for all five landing pages.
 *
 * Sections render on **presence, not role**: `feed` and `timeClock` are
 * optional on the payload, so whichever roles get them are covered without a
 * role branch here — including whichever role gets one next.
 */
export function DashboardPage() {
  const { accessToken, status: sessionStatus, user } = useSession()
  const queryClient = useQueryClient()
  const [punchError, setPunchError] = useState<string | null>(null)

  const isAuthed = sessionStatus === "authenticated" && !!accessToken

  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(accessToken!),
    enabled: isAuthed,
    refetchOnWindowFocus: true,
  })

  const punchMutation = useMutation({
    mutationFn: (kind: "in" | "out") =>
      kind === "in" ? checkInApi(accessToken!) : checkOutApi(accessToken!),
    onSuccess: () => {
      setPunchError(null)
      // The clock changes the attendance cards too, so both prefixes go.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] })
      queryClient.invalidateQueries({ queryKey: ["attendance"] })
    },
    onError: (err) => {
      // Already checked in is the outcome the user wanted; refetch rather
      // than showing an error for a button that did its job.
      if (err instanceof ApiError && err.message.includes("already checked in")) {
        setPunchError(null)
        queryClient.invalidateQueries({ queryKey: ["dashboard"] })
        return
      }
      setPunchError(
        err instanceof ApiError
          ? err.message
          : "That did not go through. You are still checked out. Please try again."
      )
    },
  })

  if (sessionStatus === "loading" || dashboardQuery.isPending) {
    return <DashboardSkeleton />
  }

  if (dashboardQuery.isError || !dashboardQuery.data) {
    return (
      <div className="mt-10 rounded-md border border-[#E4E9EF] bg-white p-8 text-center">
        <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
          <RiErrorWarningLine className="size-5" aria-hidden />
        </span>
        <div className="text-[15px] font-bold">Your dashboard could not be loaded</div>
        <p className="mx-auto mt-1 max-w-[52ch] text-[13px] leading-relaxed text-[#5F6B7C]">
          {dashboardQuery.error instanceof ApiError
            ? dashboardQuery.error.message
            : "Something went wrong on the way to the server."}
        </p>
        <Button
          className="mt-4 h-auto rounded-md bg-[#17191C] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#0E1012]"
          onClick={() => dashboardQuery.refetch()}
        >
          <RiRefreshLine className="size-4" aria-hidden />
          Try again
        </Button>
      </div>
    )
  }

  const payload = dashboardQuery.data
  const root = ROUTE_GROUP[payload.role]

  // The one clock read on this page, and it happens after the payload has
  // landed, so it never renders during hydration.
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  const narrow: ReactNode[] = []
  const wide: ReactNode[] = []

  if (payload.timeClock) {
    narrow.push(
      <TimeClockCard
        key="clock"
        state={payload.timeClock}
        pending={punchMutation.isPending}
        error={punchError}
        onCheckIn={() => punchMutation.mutate("in")}
        onCheckOut={() => punchMutation.mutate("out")}
      />
    )
  }

  if (payload.chart) {
    narrow.push(
      <ChartCard
        key="chart"
        title={payload.chart.title}
        sub={payload.chart.sub}
        bars={payload.chart.bars}
      />
    )
  }

  // Renders nothing for anyone without hub access, rather than a disabled
  // card advertising a room they cannot enter.
  if (user && (user.role === "SUPER_ADMIN" || user.salesRole)) {
    narrow.push(<HubEntryCard key="sales-hub" />)
  }

  if (payload.feed) {
    wide.push(<ActivityFeed key="feed" items={payload.feed} viewAllHref={`${root}/reports`} />)
  }

  if (payload.table) {
    wide.push(
      <DataTable
        key="table"
        title={payload.table.title}
        cols={`repeat(${payload.table.headers.length}, minmax(0, 1fr))`}
        headers={payload.table.headers}
        rows={payload.table.rows}
        action="View all"
        // Was a bare <span> that looked like a link and did nothing, while the
        // identical label on the activity feed navigated.
        actionHref={`${root}/reports`}
      />
    )
  }

  return (
    <>
      <HeroBanner
        kicker={payload.greeting.kicker}
        heading={payload.greeting.heading}
        sub={payload.greeting.sub}
        cta={payload.greeting.cta.label}
        ctaHref={payload.greeting.cta.href}
        today={today}
      />

      <StatsGrid stats={payload.stats.map(toStat)} />

      <PanelGrid narrow={narrow} wide={wide} />
    </>
  )
}
