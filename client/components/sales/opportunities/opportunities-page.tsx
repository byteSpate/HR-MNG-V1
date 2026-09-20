"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { RiArrowRightLine, RiBriefcaseLine, RiFilterOffLine, RiLayoutColumnLine } from "@remixicon/react"

import { listOpportunities, listOpportunityOwners, type ListOpportunitiesQuery } from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunityStage, OpportunityStatus, OpportunitySummary } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable, RowActions, TONE } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  OPPORTUNITY_STATUS_LABEL,
  OPPORTUNITY_STATUS_TONE,
  STAGE_LABEL,
  daysSince,
  stageSentence,
  taka,
} from "@/components/sales/shared/sales-shared"
import { StageBar } from "@/components/sales/opportunities/stage-bar"
import type { TableCell } from "@/components/dashboard/types"

const STAGGER_STEP_MS = 40
const STAGGER_MAX_STEPS = 6

/**
 * The column picker exists on this list and nowhere else (R11).
 *
 * Seven columns by default and six more available: this list is wide enough
 * that somebody tracking OEM pricing wants different columns from somebody
 * chasing close dates. A picker over a five-column table would be furniture,
 * which is why no other table here has one.
 */
type ColumnKey =
  | "serial"
  | "account"
  | "name"
  | "stage"
  | "status"
  | "value"
  | "close"
  | "owner"
  | "nextStep"
  | "nextStepDue"
  | "daysInStage"
  | "lastActivity"
  | "track"

const COLUMN_LABEL: Record<ColumnKey, string> = {
  serial: "Serial",
  account: "Account",
  name: "Opportunity",
  stage: "Stage",
  status: "Status",
  value: "Value",
  close: "Expected close",
  owner: "Owner",
  nextStep: "Next step",
  nextStepDue: "Next step due",
  daysInStage: "Days in stage",
  lastActivity: "Last activity",
  track: "Track",
}

/** Grid width per column, so the table keeps its rhythm as columns come and go. */
const COLUMN_WIDTH: Record<ColumnKey, string> = {
  serial: "auto",
  account: "minmax(0,1.2fr)",
  name: "minmax(0,1.4fr)",
  stage: "minmax(0,1fr)",
  status: "auto",
  value: "auto",
  close: "auto",
  owner: "minmax(0,1fr)",
  nextStep: "minmax(0,1.2fr)",
  nextStepDue: "auto",
  daysInStage: "auto",
  lastActivity: "auto",
  track: "auto",
}

const ALL_COLUMNS = Object.keys(COLUMN_LABEL) as ColumnKey[]
const DEFAULT_COLUMNS: ColumnKey[] = [
  "serial",
  "account",
  "name",
  "stage",
  "status",
  "value",
  "close",
]

const STAGES = Object.keys(STAGE_LABEL) as OpportunityStage[]
const STATUSES = Object.keys(OPPORTUNITY_STATUS_LABEL) as OpportunityStatus[]

/** Date-only, read as written. A close date is a calendar day, not an instant. */
function onDate(value: string | null): string {
  if (!value) return "—"
  const [year, month, day] = value.slice(0, 10).split("-")
  return `${day}/${month}/${year}`
}

function cellFor(column: ColumnKey, deal: OpportunitySummary, index: number): TableCell {
  switch (column) {
    case "serial":
      return {
        node: (
          <span
            className="rise-in font-mono text-[11.5px] text-[#6B7789] motion-reduce:animate-none"
            style={{ animationDelay: `${Math.min(index, STAGGER_MAX_STEPS) * STAGGER_STEP_MS}ms` }}
          >
            {deal.serial}
          </span>
        ),
      }
    case "account":
      return { node: <span className="block truncate">{deal.salesAccountName}</span> }
    case "name":
      return {
        node: (
          <div className="flex min-w-0 items-center gap-1.5">
            <RiBriefcaseLine className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
            <span className="truncate font-semibold">{deal.name}</span>
          </div>
        ),
      }
    case "stage":
      // Past tense on a closed deal, and the stage is kept rather than
      // cleared — "Lost, at negotiation" is a different fact from "Lost".
      return {
        node: (
          <span className="block min-w-0">
            <span className="block truncate">{stageSentence(deal.status, deal.stage)}</span>
            <StageBar status={deal.status} stage={deal.stage} className="mt-1 max-w-[9rem]" />
          </span>
        ),
      }
    case "status":
      return {
        tag: OPPORTUNITY_STATUS_LABEL[deal.status],
        tone: OPPORTUNITY_STATUS_TONE[deal.status],
      }
    case "value":
      // `taka` returns "No price yet" for a null amount. Never ৳0: a
      // deal nobody has costed is not a deal worth nothing.
      return {
        node: <span className={deal.amount === null ? TONE.muted : undefined}>{taka(deal.amount)}</span>,
      }
    case "close":
      return { node: <span>{onDate(deal.expectedCloseDate)}</span> }
    case "owner":
      return { node: <span className="block truncate">{deal.ownerName}</span> }
    case "nextStep":
      return {
        node: (
          <span className={deal.nextStep ? "block truncate" : `block truncate ${TONE.muted}`}>
            {deal.nextStep ?? "None set"}
          </span>
        ),
      }
    case "nextStepDue":
      return { node: <span>{onDate(deal.nextStepDueOn)}</span> }
    case "daysInStage":
      // Only meaningful while the deal is open. A closed deal's stage froze
      // when it closed, so counting from then would read as neglect.
      return {
        node: (
          <span className={deal.status === "ONGOING" ? undefined : TONE.muted}>
            {deal.status === "ONGOING" ? `${daysSince(deal.stageChangedAt)}d` : "—"}
          </span>
        ),
      }
    case "lastActivity":
      return { node: <span>{`${daysSince(deal.lastActivityAt)}d ago`}</span> }
    case "track":
      return { node: <span>{deal.track === "NETWORKING" ? "Networking" : deal.track}</span> }
  }
}

export function OpportunitiesPage({ actionFilters = {} }: { actionFilters?: { closing?: number; quiet?: number; stuck?: number; mine?: boolean; ownerEmployeeId?: string } }) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const router = useRouter()

  const [status, setStatus] = useState<OpportunityStatus | "">("")
  const [stage, setStage] = useState<OpportunityStage | "">("")
  const [mine, setMine] = useState(actionFilters.mine ?? false)
  const [ownerEmployeeId, setOwnerEmployeeId] = useState(actionFilters.ownerEmployeeId ?? "")
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS)
  const [pickerOpen, setPickerOpen] = useState(false)

  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const { closing, quiet, stuck } = actionFilters

  const filters: ListOpportunitiesQuery = useMemo(
    () => ({
      ...(status ? { status } : {}),
      ...(stage ? { stage } : {}),
      ...(mine ? { mine: true } : {}),
      ...(ownerEmployeeId ? { ownerEmployeeId } : {}),
      ...(closing ? { closing } : {}),
      ...(quiet ? { quiet } : {}),
      ...(stuck ? { stuck } : {}),
    }),
    [status, stage, mine, ownerEmployeeId, closing, quiet, stuck]
  )

  const query = useQuery({
    queryKey: salesKeys.opportunities(filters as Record<string, unknown>),
    queryFn: () => listOpportunities(accessToken!, filters),
    enabled: isAuthed,
  })
  const ownersQuery = useQuery({
    queryKey: ["sales", "opportunity-owners"],
    queryFn: () => listOpportunityOwners(accessToken!),
    enabled: isAuthed,
  })

  const deals = useMemo(() => query.data?.items ?? [], [query.data])
  const owners = ownersQuery.data ?? []
  const isLoading = sessionStatus === "loading" || query.isPending
  const isFiltered = Boolean(status || stage || mine || ownerEmployeeId || closing || quiet || stuck)
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")
  const viewDescription = mine
    ? "Only opportunities you own"
    : ownerEmployeeId
      ? `Opportunities owned by ${owners.find((owner) => owner.id === ownerEmployeeId)?.fullName ?? "the selected person"}`
      : isSalesAdmin
        ? "The shared team pipeline"
        : "Opportunities across the accounts you can access"

  const rows = useMemo(
    () =>
      deals.map((deal, index) => [
        ...columns.map((column) => cellFor(column, deal, index)),
        {
          node: (
            <RowActions
              actions={[{ kind: "link", label: deal.canManage ? "Work" : "View", href: `/sales/opportunities/${deal.id}` }]}
            />
          ),
        } as TableCell,
      ]),
    [deals, columns]
  )

  const clearFilters = () => {
    setStatus("")
    setStage("")
    setMine(false)
    setOwnerEmployeeId("")
    if (closing || quiet || stuck) router.replace("/sales/opportunities")
  }

  // A filtered list and an unused system are empty for different reasons, and
  // the way out of each differs. Collapsing them into one sentence sends
  // somebody looking for deals that were never there.
  const emptyTitle = isFiltered ? "Nothing matches these filters" : "No opportunities yet"
  const emptyBody = isFiltered
    ? "No deal matches every filter at once. Widening one of them is usually enough."
    : "An opportunity is a live deal on a Sales Account — what is being sold, at what stage, and what happens next. Open an account and press New opportunity."

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Opportunities"
        sub={
          isSalesAdmin
            ? "The shared pipeline, with each stage saying who the deal is waiting on."
            : "The deals across your accessible accounts, with each stage saying who is next."
        }
      />

      {/* Hidden while the first page loads. A filter row beside a skeleton
          reads as an answer about a list nobody has counted yet. */}
      {!isLoading && !query.isError ? (
        <section className="mb-3 rounded-md border border-[#E4E9EF] bg-white p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-[14px] font-bold tracking-tight">Refine the view</h2>
              <p className={`mt-0.5 text-[12px] ${TONE.muted}`}>{viewDescription}</p>
            </div>
            <div className="flex items-center gap-2">
              {closing || quiet || stuck ? (
                <span className="rounded-md bg-[#F1F4F7] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#5F6B7C]">
                  {closing ? `Closing in ${closing} days` : quiet ? `Quiet for ${quiet}+ days` : `Stuck for ${stuck}+ days`}
                </span>
              ) : null}
              <Button
                type="button"
                onClick={() => setPickerOpen((prev) => !prev)}
                aria-expanded={pickerOpen}
                className="h-8 gap-1.5 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
              >
                <RiLayoutColumnLine className="size-3.5" aria-hidden />
                {columns.length} columns
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#EEF1F5] pt-3">
          <Select value={status} onValueChange={(v) => setStatus((v ?? "") as OpportunityStatus | "")}>
            <SelectTrigger aria-label="Opportunity status" className="h-9 w-auto min-w-[9rem]">
              <SelectValue>
                {(v: string | null) =>
                  v ? OPPORTUNITY_STATUS_LABEL[v as OpportunityStatus] : "Any status"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {OPPORTUNITY_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={stage} onValueChange={(v) => setStage((v ?? "") as OpportunityStage | "")}>
            <SelectTrigger aria-label="Opportunity stage" className="h-9 w-auto min-w-[11rem]">
              <SelectValue>
                {(v: string | null) => (v ? STAGE_LABEL[v as OpportunityStage] : "Any stage")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STAGE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            onClick={() => setMine((prev) => !prev)}
            aria-pressed={mine}
            className={
              mine
                ? "h-9 rounded-md bg-[#17191C] px-3 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
                : "h-9 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
            }
          >
            Mine only
          </Button>

          <Select value={ownerEmployeeId} onValueChange={(v) => setOwnerEmployeeId(v ?? "")}>
            <SelectTrigger aria-label="Opportunity owner" className="h-9 w-auto min-w-[10rem]">
              <SelectValue>
                {(v: string | null) => owners.find((owner) => owner.id === v)?.fullName ?? "Any owner"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {owners.map((owner) => (
                <SelectItem key={owner.id} value={owner.id}>{owner.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isFiltered ? (
            <Button
              type="button"
              variant="link"
              onClick={clearFilters}
              className="h-9 gap-1.5 p-0 text-[12.5px] font-bold text-[#5F6B7C]"
            >
              <RiFilterOffLine className="size-3.5" aria-hidden />
              Clear
            </Button>
          ) : null}

          </div>

          {pickerOpen ? (
            <div className="mt-3 border-t border-[#EEF1F5] pt-3">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] font-bold">Visible columns</span>
                <span className={`text-[11.5px] ${TONE.muted}`}>{columns.length} of {ALL_COLUMNS.length} shown</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ALL_COLUMNS.map((column) => {
                  const checked = columns.includes(column)
                  // The last remaining column cannot be removed: a table with
                  // no columns is not a narrower view, it is a broken one.
                  const isLast = checked && columns.length === 1
                  return (
                    <label
                      key={column}
                      className={`flex items-center gap-1.5 text-[12.5px] ${
                        isLast ? "opacity-50" : "cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLast}
                        onChange={() =>
                          setColumns((prev) =>
                            prev.includes(column)
                              ? prev.filter((c) => c !== column)
                              : ALL_COLUMNS.filter((c) => prev.includes(c) || c === column)
                          )
                        }
                        className="size-3.5 accent-[#17191C]"
                      />
                      {COLUMN_LABEL[column]}
                    </label>
                  )
                })}
              </div>
              <Button
                type="button"
                variant="link"
                onClick={() => setColumns(DEFAULT_COLUMNS)}
                className="mt-2 h-auto p-0 text-[12px] font-bold text-[#5F6B7C]"
              >
                Reset to default
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <PanelTable
        cols={`${columns.map((c) => COLUMN_WIDTH[c]).join(" ")} auto`}
        headers={[...columns.map((c) => COLUMN_LABEL[c]), ""]}
        rows={rows}
        isLoading={isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        // The only action a filtered empty state can offer is to widen the
        // filter. An unfiltered one has nowhere to send anybody: a deal is
        // created from its account, not from this list, so a button here
        // would be a control that cannot do anything.
        emptyAction={isFiltered ? "Clear filters" : undefined}
        emptyActionIcon={isFiltered ? <RiArrowRightLine className="size-4" aria-hidden /> : undefined}
        onEmptyAction={clearFilters}
      />
    </>
  )
}
