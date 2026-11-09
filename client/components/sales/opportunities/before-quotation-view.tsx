"use client"

/**
 * Before Quotation (owner, 2026-11-02): the Opportunities that have not had a
 * quote yet, in the Funnel's look but with no quote anywhere. A top strip of
 * counters, filters, and a grid with one row for each Opportunity.
 *
 * It reads the same Opportunity record as the All Opportunities list, so a
 * next step, a stage link or an expected quote date saved anywhere shows here
 * by itself. It is used on the Opportunities page, and by the Saturday page for
 * one person (`ownerEmployeeId` fixed, `showFilters` off).
 */

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiAlertLine, RiBriefcaseLine, RiCalendarCheckLine, RiFilterOffLine, RiTaskLine, RiTimeLine } from "@remixicon/react"

import {
  getBeforeQuotationSummary,
  listOpportunities,
  listOpportunityOwners,
  updateOpportunity,
  type ListOpportunitiesQuery,
} from "@/lib/api/sales/opportunities"
import { salesKeys } from "@/lib/api/sales/keys"
import { BEFORE_QUOTE_STAGES } from "@/lib/api/sales/stages"
import { useSession } from "@/lib/auth/session-context"
import { daysInStage, nextStepParts, quoteDueState } from "@/lib/before-quotation"
import type { OpportunityStage, OpportunitySummary } from "@/lib/api/types"
import { PanelTable, TONE, toMessage } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { Tag } from "@/components/dashboard/tag"
import { StageBar } from "@/components/sales/opportunities/stage-bar"
import { daysSince, onDay, STAGE_LABEL, stageSentence } from "@/components/sales/shared/sales-shared"
import { sized } from "@/components/sales/shared/sized-cell"
import { SalesStatRow, type SalesStat } from "@/components/sales/shared/stat-row"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const HEADERS = ["Account", "Opportunity", "Stage", "Days in stage", "Expected quote date", "Next step", "Last activity", "Owner"]
const COLS =
  "minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr) auto minmax(0,1.1fr) minmax(0,1.3fr) auto minmax(0,0.9fr)"
/** A select's "any", since an empty value reads as nothing chosen at all. */
const ANY = "any"
/** Every stage that is before a quote, on either track, each once and in order. */
const STAGES: OpportunityStage[] = [
  ...new Set<OpportunityStage>([...BEFORE_QUOTE_STAGES.NETWORKING, ...BEFORE_QUOTE_STAGES.SOFTWARE_DEVELOPMENT]),
]
const TOGGLE_ON = "h-9 rounded-md bg-ink px-3 text-caption font-bold text-white hover:bg-ink-strong"
const TOGGLE_OFF =
  "h-9 rounded-md border border-line bg-white px-3 text-caption font-bold text-ink hover:bg-surface-subtle"

const todayInput = () => new Date().toLocaleDateString("en-CA")

/**
 * The expected quote day, changed in place by whoever may manage the
 * Opportunity. Anyone else reads it. It is a reminder only and never blocks a
 * stage move.
 */
function QuoteDateCell({ deal }: { deal: OpportunitySummary }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const state = quoteDueState(deal.expectedQuoteOn, todayInput())
  const save = useMutation({
    mutationFn: (value: string) => updateOpportunity(accessToken!, deal.id, { expectedQuoteOn: value || null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sales", "opportunities"] }),
  })
  return (
    <span className="block min-w-0">
      <span className="flex flex-wrap items-center gap-1.5">
        {deal.canManage ? (
          <Input
            type="date"
            aria-label={`Expected quote date for ${deal.name}`}
            defaultValue={deal.expectedQuoteOn ?? ""}
            disabled={save.isPending}
            onChange={(e) => {
              // A half-typed date is "" until it is whole; only a finished one is sent.
              if (e.target.value !== (deal.expectedQuoteOn ?? "")) save.mutate(e.target.value)
            }}
            className="h-8 w-36 text-caption"
          />
        ) : (
          <span className={deal.expectedQuoteOn ? undefined : TONE.muted}>
            {deal.expectedQuoteOn ? onDay(deal.expectedQuoteOn) : "Not set"}
          </span>
        )}
        {state === "late" ? <Tag label="Late" tone="red" /> : state === "soon" ? <Tag label="Soon" tone="yellow" /> : null}
        {/* The box is locked while the date saves, so say so. Polite, not an alert. */}
        {save.isPending ? (
          <span role="status" className={`text-caption ${TONE.muted}`}>
            Saving…
          </span>
        ) : null}
      </span>
      {save.isError ? <span className="mt-0.5 block text-caption text-danger">{toMessage(save.error)}</span> : null}
    </span>
  )
}

export function BeforeQuotationView({
  ownerEmployeeId,
  showFilters = true,
  onOpenOpportunity,
}: {
  /** Fixed to one person (the Saturday page). Absent: the viewer picks. */
  ownerEmployeeId?: string
  /** The Owner, Mine and Stage filters. Off when the person is fixed. */
  showFilters?: boolean
  /** When given, the Opportunity name opens this instead of a page, so a side panel can show it. */
  onOpenOpportunity?: (deal: OpportunitySummary) => void
}) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  const [stage, setStage] = useState<OpportunityStage | "">("")
  const [mine, setMine] = useState(false)
  const [owner, setOwner] = useState("")
  const ownerFilter = ownerEmployeeId ?? owner

  const filters: ListOpportunitiesQuery = useMemo(
    () => ({
      view: "BEFORE_QUOTATION",
      limit: 100,
      ...(stage ? { stage } : {}),
      ...(mine && !ownerEmployeeId ? { mine: true } : {}),
      ...(ownerFilter ? { ownerEmployeeId: ownerFilter } : {}),
    }),
    [stage, mine, ownerFilter, ownerEmployeeId]
  )
  const summaryFilters = useMemo(
    () => ({
      ...(mine && !ownerEmployeeId ? { mine: true } : {}),
      ...(ownerFilter ? { ownerEmployeeId: ownerFilter } : {}),
    }),
    [mine, ownerFilter, ownerEmployeeId]
  )

  const query = useQuery({
    queryKey: salesKeys.opportunities(filters as Record<string, unknown>),
    queryFn: () => listOpportunities(accessToken!, filters),
    enabled: isAuthed,
  })
  const summary = useQuery({
    queryKey: salesKeys.beforeQuotationSummary(summaryFilters),
    queryFn: () => getBeforeQuotationSummary(accessToken!, summaryFilters),
    enabled: isAuthed,
  })
  const owners = useQuery({
    queryKey: ["sales", "opportunity-owners"],
    queryFn: () => listOpportunityOwners(accessToken!),
    enabled: isAuthed && showFilters && !ownerEmployeeId,
  })

  const deals = useMemo(() => query.data?.items ?? [], [query.data])
  const isLoading = sessionStatus === "loading" || query.isPending
  const isFiltered = Boolean(stage || mine || (!ownerEmployeeId && owner))
  const partial = query.data?.nextCursor != null

  const stats = useMemo<SalesStat[]>(() => {
    const c = summary.data
    const n = (value: number | undefined) => (c ? String(value ?? 0) : "-")
    return [
      { label: "Quote due soon", value: n(c?.quoteDueSoon), sub: "Expected in the next 14 days", icon: RiCalendarCheckLine },
      { label: "No next step", value: n(c?.noNextStep), sub: c && c.noNextStep > 0 ? "Nobody has said what is next" : "Every one has a next step", icon: RiTaskLine },
      { label: "Quiet", value: n(c?.quiet), sub: "No activity for 30 days", icon: RiTimeLine },
      { label: "Stuck", value: n(c?.stuck), sub: "In one stage for 21 days", icon: RiAlertLine },
    ]
  }, [summary.data])

  const now = new Date()
  const rows: TableCell[][] = deals.map((deal) => {
    const next = nextStepParts(deal)
    return [
      { node: <span className="block truncate">{deal.salesAccountName}</span> },
      {
        node: (
          <div className="flex min-w-0 items-center gap-1.5">
            <RiBriefcaseLine className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
            {onOpenOpportunity ? (
              <button
                type="button"
                onClick={() => onOpenOpportunity(deal)}
                className="truncate text-left font-semibold hover:underline focus-visible:ring-2 focus-visible:ring-ink/25 focus-visible:outline-none"
              >
                {deal.name}
              </button>
            ) : (
              <span className="truncate font-semibold">{deal.name}</span>
            )}
          </div>
        ),
      },
      {
        node: (
          <span className="block min-w-0">
            <span className="block truncate">{stageSentence(deal.status, deal.stage)}</span>
            <StageBar status={deal.status} stage={deal.stage} track={deal.track} className="mt-1 max-w-[9rem]" />
          </span>
        ),
      },
      { node: <span>{`${daysInStage(deal.stageChangedAt, now)}d`}</span> },
      { node: <QuoteDateCell deal={deal} /> },
      {
        node: next.text ? (
          <span className="block min-w-0">
            <span className="block truncate">{next.text}</span>
            {next.dueOn ? <span className={`block text-caption ${TONE.muted}`}>{onDay(next.dueOn)}</span> : null}
          </span>
        ) : (
          <span className={`block truncate ${TONE.muted}`}>No next step</span>
        ),
      },
      { node: <span>{`${daysSince(deal.lastActivityAt)}d ago`}</span> },
      { node: <span className="block truncate">{deal.ownerName}</span> },
    ] as TableCell[]
  }).map((row) => row.map(sized))

  const clearFilters = () => {
    setStage("")
    setMine(false)
    setOwner("")
  }

  return (
    <>
      <SalesStatRow stats={stats} isLoading={summary.isPending} isError={summary.isError} />

      {/* Hidden while the first page loads. A filter beside a skeleton reads as an
          answer about a list nobody has counted yet. */}
      {showFilters && !isLoading && !query.isError ? (
        <section className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-white p-3 sm:p-4">
          <Select value={stage || ANY} onValueChange={(v) => setStage(!v || v === ANY ? "" : (v as OpportunityStage))}>
            <SelectTrigger aria-label="Opportunity stage" className="h-9 w-auto min-w-[11rem]">
              <SelectValue>{(v: string | null) => (v && v !== ANY ? STAGE_LABEL[v as OpportunityStage] : "Any early stage")}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any early stage</SelectItem>
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isSalesAdmin && (owners.data ?? []).length > 0 ? (
            <Select value={owner || ANY} onValueChange={(v) => setOwner(!v || v === ANY ? "" : v)}>
              <SelectTrigger aria-label="Opportunity owner" className="h-9 w-auto min-w-[10rem]">
                <SelectValue>
                  {(v: string | null) => (v && v !== ANY ? (owners.data?.find((o) => o.id === v)?.fullName ?? "An owner") : "Any owner")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any owner</SelectItem>
                {(owners.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Button type="button" aria-pressed={mine} onClick={() => setMine(!mine)} className={mine ? TOGGLE_ON : TOGGLE_OFF}>
            Mine only
          </Button>

          {isFiltered ? (
            <Button type="button" variant="link" onClick={clearFilters} className="h-9 gap-1.5 p-0 text-caption font-bold text-ink-muted">
              <RiFilterOffLine className="size-3.5" aria-hidden />
              Clear
            </Button>
          ) : null}
        </section>
      ) : null}

      <PanelTable
        title="Before Quotation"
        emptyIcon={RiBriefcaseLine}
        cols={COLS}
        headers={HEADERS}
        rows={rows}
        rowHrefs={onOpenOpportunity ? undefined : deals.map((deal) => `/sales/opportunities/${deal.id}`)}
        isLoading={isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={isFiltered ? "Nothing matches these filters" : "Nothing is waiting for a quote"}
        emptyBody={
          isFiltered
            ? "No Opportunity matches every filter at once. Widening one of them is usually enough."
            : "Every ongoing Opportunity has had its first quote, or there are none yet. A new one shows here until its quote is sent."
        }
        emptyAction={isFiltered ? "Clear filters" : undefined}
        onEmptyAction={clearFilters}
      />
      {partial ? <p className={`mt-2 text-caption ${TONE.muted}`}>Showing the first {deals.length}. Use a filter to narrow the list.</p> : null}
    </>
  )
}
