"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiArchiveLine,
  RiInboxLine,
  RiMoneyDollarCircleLine,
  RiQuestionMark,
  RiToolsLine,
  RiUploadCloud2Line,
} from "@remixicon/react"

import {
  acknowledgeAssignment,
  approveAssetRequest,
  cancelAssetRequest,
  capitaliseAsset,
  disposeAsset,
  getMyHoldings,
  listAssetRequests,
  listAssets,
  listCategories,
  listRepairs,
  listUnacknowledged,
  markAssetLost,
  markAssetRequestOrdered,
  payForAsset,
  rejectAssetRequest,
  retireAsset,
} from "@/lib/api/assets"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { Asset, AssetAssignment, AssetRepair, AssetRequest } from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { ALL, FilterBar, FilterSelect } from "@/components/dashboard/filter-bar"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert, PanelTable } from "@/components/dashboard/record-kit"
import type { TableCell } from "@/components/dashboard/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AssetDetail } from "@/components/asset/asset-detail"
import { AssignDialog } from "@/components/asset/assign-dialog"
import { CreateAssetDialog } from "@/components/asset/create-asset-dialog"
import { DisposeDialog } from "@/components/asset/dispose-dialog"
import { FulfilDialog } from "@/components/asset/fulfil-dialog"
import { ImportWizard } from "@/components/asset/import-wizard"
import { ReceiveRepairDialog } from "@/components/asset/receive-repair-dialog"
import { RepairDialog } from "@/components/asset/repair-dialog"
import { RequestDetail } from "@/components/asset/request-detail"
import { RequestDialog } from "@/components/asset/request-dialog"
import { ReturnDialog } from "@/components/asset/return-dialog"
import { DecisionDialog } from "@/components/leave/decision-dialog"
import { ConfirmDialog } from "@/components/dashboard/record-kit"
import { RecoveriesTab } from "@/components/asset/recoveries-tab"
import { MyRecoveries } from "@/components/asset/my-recoveries"
import { LifecycleRecoveryDialog } from "@/components/asset/lifecycle-recovery-dialog"
import {
  availableOf,
  canDispose,
  canManageAssets,
  CONDITION_LABEL,
  formatAssetDate,
  isRequestOpen,
  isStaff,
  LEDGER_STATE_LABEL,
  LEDGER_STATE_TONE,
  ledgerStateOf,
  REQUEST_STAGE_LABEL,
  REQUEST_STAGE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/components/asset/asset-shared"

interface Filters {
  status?: string
  categoryId?: string
  q?: string
}

/** Options for the register's status filter. `ALL` is the shared sentinel from
 *  filter-bar, so the "no filter" value means the same thing on every page. */
const STATUS_OPTIONS = (["AVAILABLE", "ASSIGNED", "IN_REPAIR", "LOST", "RETIRED"] as const).map(
  (value) => ({ value, label: STATUS_LABEL[value] })
)

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[15px] font-bold">{children}</div>
}

/**
 * The shape every table on this page now takes.
 *
 * Each of the five used to be `rows.length === 0 ? <p/> : <Table/>`, wrapped
 * at the call site in `isPending ? <Skeleton/> : isError ? <LoadError/> : …`.
 * That was eight copies of the same three-way branch, a local LoadError
 * duplicating the kit's, and a single grey block standing in for a table.
 * PanelTable holds all four states, so the branch and the duplicate are gone.
 */
interface TableState {
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}

/** A cell that renders a status pill. Kept as a node rather than PanelTable's
 *  own `tag`, because the asset tones are Tailwind class strings carrying
 *  dark-mode variants and the kit's `Tone` union has no equivalent. */
const badgeCell = (className: string, label: string, sub?: string): TableCell => ({
  node: (
    <div className="flex flex-col items-start gap-1">
      <Badge className={className}>{label}</Badge>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  ),
})

/** The register: every asset row, tag-first. Cost only renders when the
 *  server actually sent it — never from a role check re-derived here. */
function AssetTable({
  assets,
  onView,
  onEdit,
  emptyTitle,
  emptyBody,
  emptyAction,
  onEmptyAction,
  ...state
}: TableState & {
  assets: Asset[]
  onView: (id: string) => void
  /** HR / Super Admin only — absent for Finance and managers, matching the
   *  server's HR_ROLES on PATCH /api/assets/:id. */
  onEdit?: (id: string) => void
  emptyTitle: string
  emptyBody: string
  emptyAction: string
  onEmptyAction: () => void
}) {
  // Presence of the key, not a role check re-derived here: the server omits
  // the field entirely for viewers who may not see cost.
  const showCost = assets.some((a) => "purchaseCost" in a)

  const headers = [
    "Tag",
    "Name",
    "Category",
    "Status",
    "Serial",
    "Location",
    ...(showCost ? ["Cost"] : []),
    "",
  ]
  const cols = showCost ? "0.9fr 1.3fr 0.9fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr" : "0.9fr 1.3fr 0.9fr 1fr 0.9fr 0.9fr 0.9fr"

  const rows: TableCell[][] = assets.map((asset) => [
    { text: asset.assetTag, weight: 600 },
    { text: asset.name },
    { text: asset.category.name },
    // The holder is shown whenever there is one, IN_REPAIR included: a named
    // person can still be responsible while the asset sits at the vendor, and
    // collapsing that to one word loses the answer the register exists to give.
    badgeCell(
      STATUS_TONE[asset.status],
      STATUS_LABEL[asset.status],
      asset.heldBy ? `Held by ${asset.heldBy.fullName}` : undefined
    ),
    { text: asset.serialNumber ?? "" },
    { text: asset.location ?? "" },
    ...(showCost
      ? [
          {
            text:
              "purchaseCost" in asset && asset.purchaseCost
                ? formatMoney(asset.purchaseCost, asset.currency)
                : "",
          },
        ]
      : []),
    {
      node: (
        <div className="flex justify-end gap-2 whitespace-nowrap">
          {onEdit ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onEdit(asset.id)}>
              Edit
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" onClick={() => onView(asset.id)}>
            View
          </Button>
        </div>
      ),
    },
  ])

  return (
    <PanelTable
      cols={cols}
      headers={headers}
      rows={rows}
      emptyTitle={emptyTitle}
      emptyBody={emptyBody}
      emptyAction={emptyAction}
      onEmptyAction={onEmptyAction}
      {...state}
    />
  )
}

/** The ledger half of the register, Finance-only. Each row carries its
 *  capitalisation state — Not capitalised / Capitalised, unpaid / Paid — and
 *  the two actions, plus disposal. The HR register shows none of this. */
function FinanceAssetTable({
  assets,
  onView,
  onCapitalise,
  onPay,
  onDispose,
  capitalisingId,
  payingId,
  disposingId,
  emptyTitle,
  emptyBody,
  emptyAction,
  onEmptyAction,
  ...state
}: TableState & {
  assets: Asset[]
  onView: (id: string) => void
  onCapitalise: (id: string) => void
  onPay: (id: string) => void
  onDispose: (id: string) => void
  capitalisingId: string | null
  payingId: string | null
  disposingId: string | null
  emptyTitle: string
  emptyBody: string
  emptyAction: string
  onEmptyAction: () => void
}) {
  const headers = [
    "Tag",
    "Name",
    "Category",
    "Status",
    "Cost",
    "Ledger",
    "",
  ]
  const cols = "0.9fr 1.3fr 0.9fr 1fr 0.9fr 1.1fr 1.4fr"

  const rows: TableCell[][] = assets.map((asset) => {
    // Read through ledgerStateOf, never from the fields directly — see the note
    // on it in asset-shared.ts for what reading them here cost last time.
    const ledger = ledgerStateOf(asset)
    const capitalised = ledger !== "NOT_CAPITALISED"
    const paid = ledger === "PAID"

    return [
      { text: asset.assetTag, weight: 600 },
      { text: asset.name },
      { text: asset.category.name },
      badgeCell(
        STATUS_TONE[asset.status],
        STATUS_LABEL[asset.status],
        asset.heldBy ? `Held by ${asset.heldBy.fullName}` : undefined
      ),
      {
        text:
          "purchaseCost" in asset && asset.purchaseCost
            ? formatMoney(asset.purchaseCost, asset.currency)
            : "",
      },
      badgeCell(LEDGER_STATE_TONE[ledger], LEDGER_STATE_LABEL[ledger]),
      {
        node: (
          <div className="flex justify-end gap-2 whitespace-nowrap">
            {!capitalised ? (
              <Button
                type="button"
                size="sm"
                disabled={capitalisingId === asset.id}
                onClick={() => onCapitalise(asset.id)}
              >
                {capitalisingId === asset.id ? "Capitalising…" : "Capitalise"}
              </Button>
            ) : null}
            {capitalised && !paid ? (
              <Button
                type="button"
                size="sm"
                disabled={payingId === asset.id}
                onClick={() => onPay(asset.id)}
              >
                {payingId === asset.id ? "Paying…" : "Pay"}
              </Button>
            ) : null}
            {/* Gated on capitalisation as well as lifecycle: disposal removes
                cost and accumulated depreciation from the balance sheet, and an
                asset that was never capitalised put nothing there. The server
                refuses it — "was never capitalised, so there is nothing to
                dispose of" — so offering the button was offering a 409. */}
            {capitalised && asset.status !== "RETIRED" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disposingId === asset.id}
                onClick={() => onDispose(asset.id)}
              >
                Dispose
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={() => onView(asset.id)}>
              View
            </Button>
          </div>
        ),
      },
    ]
  })

  return (
    <PanelTable
      cols={cols}
      headers={headers}
      rows={rows}
      emptyTitle={emptyTitle}
      emptyBody={emptyBody}
      emptyAction={emptyAction}
      onEmptyAction={onEmptyAction}
      {...state}
    />
  )
}

/** "What I'm holding" — the caller's own open and past custody. */
/** The asset a row is about, tag first, falling back to the raw id when the
 *  server did not expand the relation. */
const assetLabel = (a: { asset?: { assetTag: string; name: string } | null; assetId: string }) =>
  a.asset ? `${a.asset.assetTag} · ${a.asset.name}` : a.assetId

function HoldingsTable({
  assignments,
  onAcknowledge,
  acknowledgingId,
  ...state
}: TableState & {
  assignments: AssetAssignment[]
  onAcknowledge?: (assignmentId: string) => void
  acknowledgingId: string | null
}) {
  const open = assignments.filter((a) => a.returnedAt === null)

  const rows: TableCell[][] = open.map((a) => [
    { text: assetLabel(a), weight: 600 },
    { text: a.asset?.category.name ?? "" },
    { text: formatAssetDate(a.assignedAt) },
    { text: CONDITION_LABEL[a.conditionOut] },
    ...(onAcknowledge
      ? [
          {
            node:
              a.acknowledgedAt === null ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    disabled={acknowledgingId === a.id}
                    onClick={() => onAcknowledge(a.id)}
                  >
                    {acknowledgingId === a.id ? "Acknowledging…" : "Acknowledge"}
                  </Button>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Acknowledged</span>
              ),
          },
        ]
      : []),
  ])

  return (
    <PanelTable
      cols={onAcknowledge ? "1.5fr 0.9fr 0.9fr 0.9fr 1fr" : "1.5fr 0.9fr 0.9fr 0.9fr"}
      headers={[
        "Asset",
        "Category",
        "Assigned",
        "Condition out",
        ...(onAcknowledge ? [""] : []),
      ]}
      rows={rows}
      emptyTitle="Nothing assigned to you"
      emptyBody="Anything handed to you appears here, with the condition it was in when you received it."
      emptyAction="Refresh"
      onEmptyAction={state.onRetry}
      {...state}
    />
  )
}

function UnacknowledgedTable({
  assignments,
  ...state
}: TableState & { assignments: AssetAssignment[] }) {
  const rows: TableCell[][] = assignments.map((a) => [
    { text: assetLabel(a), weight: 600 },
    {
      text: a.employee ? a.employee.fullName : a.employeeId,
      sub: a.employee?.employeeCode,
    },
    { text: formatAssetDate(a.assignedAt) },
    { text: CONDITION_LABEL[a.conditionOut] },
  ])

  return (
    <PanelTable
      cols="1.5fr 1.2fr 0.9fr 0.9fr"
      headers={["Asset", "Employee", "Assigned", "Condition out"]}
      rows={rows}
      // An empty queue here is the good outcome, so it reads as one rather
      // than inviting the reader to go and create something.
      emptyTitle="Every handover is acknowledged"
      emptyBody="Assets handed over but not yet confirmed by the holder show up here."
      emptyAction="Refresh"
      onEmptyAction={state.onRetry}
      {...state}
    />
  )
}

function RepairsTable({
  repairs,
  onReceive,
  ...state
}: TableState & {
  repairs: AssetRepair[]
  /** HR / Super Admin only, matching the server's guard on the receive route. */
  onReceive?: (repair: AssetRepair) => void
}) {
  const rows: TableCell[][] = repairs.map((r) => [
    { text: assetLabel(r), weight: 600 },
    { text: r.vendor ?? "Not recorded" },
    { text: r.fault },
    { text: formatAssetDate(r.sentAt) },
    { text: formatAssetDate(r.expectedBack) },
    { text: r.isWarranty ? "Yes" : "No" },
    // Without this the flow was one-way: an asset could be sent to a vendor
    // and never came back, staying IN_REPAIR forever and unavailable to assign.
    ...(onReceive
      ? [
          {
            node: (
              <div className="flex justify-end whitespace-nowrap">
                <Button type="button" size="sm" variant="outline" onClick={() => onReceive(r)}>
                  Book back in
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ])

  return (
    <PanelTable
      cols={
        onReceive
          ? "1.3fr 0.9fr 1.4fr 0.8fr 0.9fr 0.6fr 1fr"
          : "1.3fr 0.9fr 1.4fr 0.8fr 0.9fr 0.6fr"
      }
      headers={[
        "Asset",
        "Vendor",
        "Fault",
        "Sent",
        "Expected back",
        "Warranty",
        ...(onReceive ? [""] : []),
      ]}
      rows={rows}
      emptyTitle="Nothing is in repair"
      emptyBody="Assets sent to a vendor appear here until they are booked back in."
      emptyAction="Refresh"
      onEmptyAction={state.onRetry}
      {...state}
    />
  )
}

function RequestsTable({
  requests,
  assets,
  ownEmployeeCode,
  canDecide,
  onApprove,
  onReject,
  onView,
  onFulfil,
  onAddAsset,
  onMarkOrdered,
  onWithdraw,
  approvingId,
  emptyTitle,
  emptyBody,
  ...state
}: TableState & {
  requests: AssetRequest[]
  /**
   * The **whole** register, unfiltered, so a row can say how many units of the
   * requested category are free. It must not be the Register tab's filtered
   * result: filtering that tab to "Assigned" would otherwise flip every row
   * here to "nothing in stock", which is a different claim about the world.
   *
   * `undefined` means *not known yet* (still loading, or the caller never had
   * it) and is deliberately distinct from an empty array, which means *nothing
   * is free*. Collapsing the two would print a count nobody has counted.
   */
  assets?: Asset[]
  ownEmployeeCode?: string
  canDecide: boolean
  onApprove: (id: string) => void
  onReject: (id: string) => void
  /** Opens the request's history. Available to every viewer of the row. */
  onView?: (request: AssetRequest) => void
  /** HR / Super Admin only: the step that turns an approval into custody. */
  onFulfil?: (request: AssetRequest) => void
  /** HR / Super Admin: add the thing that was approved, prefilled from the row. */
  onAddAsset?: (request: AssetRequest) => void
  /** HR / Super Admin: record that it has been ordered but has not arrived. */
  onMarkOrdered?: (request: AssetRequest) => void
  /** The requester's own way out, before anybody has decided. */
  onWithdraw?: (request: AssetRequest) => void
  approvingId: string | null
  emptyTitle: string
  emptyBody: string
}) {
  // `onView` counts: without it a read-only viewer (Finance) gets no action
  // column at all, and the history is the one thing they came for.
  const showActions = canDecide || !!onWithdraw || !!onView

  const rows: TableCell[][] = requests.map((r) => {
    // Nobody decides their own request — matching the server, so the button
    // never appears only to 403 when pressed.
    const isOwn = !!ownEmployeeCode && r.employee?.employeeCode === ownEmployeeCode
    // A supply (quantity set) is issued by count and never registered; a
    // tracked item is handed over from the register, so the free-unit count
    // is what decides whether "Hand over" can do anything.
    const tracked = r.quantity === null
    const awaitingItem = r.kind === "NEW_ITEM" && (r.stage === "APPROVED" || r.stage === "ORDERED")
    // `null` while the register is unknown — see the `assets` prop above.
    const freeUnits = assets ? availableOf(assets, r.categoryId) : null
    const canHandOver = freeUnits !== null && freeUnits > 0
    return [
      {
        text: r.employee ? r.employee.fullName : r.employeeId,
        sub: r.employee?.employeeCode,
        weight: 600,
      },
      {
        text: r.category?.name ?? "No category",
        // The number the buttons below are reasoning from, said out loud. A
        // category is a posting bucket, not a product — "1 available" for
        // Furniture may well be a chair when the request is for a printer
        // table — so the count is offered as evidence, not as an answer.
        // Absent while the register is unknown and absent at zero: "0
        // available" beside an Add asset button answers a question nobody
        // asked, and while loading it would be a number nobody counted.
        sub: awaitingItem && tracked && canHandOver ? `${freeUnits} available` : undefined,
      },
      { text: r.reason },
      // The stage, not the stored status. "Approved" alone was the same word
      // for a laptop nobody has bought, a machine at the repairer and a
      // monitor waiting to be collected.
      badgeCell(
        REQUEST_STAGE_TONE[r.stage],
        REQUEST_STAGE_LABEL[r.stage],
        r.stage === "REJECTED" && r.decisionNote ? r.decisionNote : undefined
      ),
      ...(showActions
        ? [
            {
              node: (
                <div className="flex justify-end gap-2 whitespace-nowrap">
                  {/* First, and on every row regardless of stage: the history
                      is the one thing that is always worth opening, including
                      on a request that was rejected six months ago. Matches
                      the register, where View is also the constant. */}
                  {onView ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onView(r)}>
                      View
                    </Button>
                  ) : null}

                  {canDecide && r.stage === "AWAITING_APPROVAL" && !isOwn ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        disabled={approvingId === r.id}
                        onClick={() => onApprove(r.id)}
                      >
                        Approve
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => onReject(r.id)}>
                        Reject
                      </Button>
                    </>
                  ) : null}

                  {/* An approved item has two honest next steps and they are
                      not exclusive. This used to be an either/or on stock:
                      free unit in the category ⇒ "Hand over" only. But
                      `AssetCategory` is a posting and depreciation bucket
                      (`classification`, `usefulLifeMonths`, `isConsumable`),
                      not a product list — a chair and a printer table are both
                      Furniture. So "we own a free Furniture item" is not "we
                      own the thing they asked for", and owning one chair must
                      not be what makes buying a printer table unreachable.
                      Both are offered; which one is primary is the only thing
                      stock decides. Repairs and returns are excluded: their
                      next act happens on the asset, not here. */}
                  {awaitingItem ? (
                    tracked ? (
                      <>
                        {/* Only with a free unit behind it — the dialog would
                            otherwise open onto an empty picker, a dead end you
                            could only find by clicking. */}
                        {onFulfil && canHandOver ? (
                          <Button type="button" size="sm" onClick={() => onFulfil(r)}>
                            Hand over
                          </Button>
                        ) : null}
                        {onAddAsset ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={canHandOver ? "outline" : "default"}
                            onClick={() => onAddAsset(r)}
                          >
                            Add asset
                          </Button>
                        ) : null}
                        {/* Records that somebody went shopping, so "approved and
                            forgotten" stops looking like "approved and ordered". */}
                        {onMarkOrdered && r.stage === "APPROVED" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onMarkOrdered(r)}
                          >
                            Mark ordered
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      /* A supply (`quantity` set) is issued by count from a
                         category that does not track units individually.
                         Fulfilling one never touches the register, so there is
                         no stock to check and "Add asset" would register a
                         thing that is not an asset. Hand over is the whole
                         story here, and stays unconditional. */
                      onFulfil ? (
                        <Button type="button" size="sm" onClick={() => onFulfil(r)}>
                          Hand over
                        </Button>
                      ) : null
                    )
                  ) : null}

                  {onWithdraw && r.stage === "AWAITING_APPROVAL" && isOwn ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onWithdraw(r)}>
                      Withdraw
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]
        : []),
    ]
  })

  return (
    <PanelTable
      cols={showActions ? "1.3fr 0.9fr 1.6fr 1fr 1.2fr" : "1.3fr 0.9fr 1.6fr 1fr"}
      headers={["Employee", "Category", "Reason", "Status", ...(showActions ? [""] : [])]}
      rows={rows}
      emptyTitle={emptyTitle}
      emptyBody={emptyBody}
      emptyAction="Refresh"
      onEmptyAction={state.onRetry}
      {...state}
    />
  )
}

/**
 * The register's filters, on the shared bar.
 *
 * These were three labelled controls in a row with no result count, so a
 * filter that matched nothing looked the same as a register that was empty.
 * Unlike the other pages this one filters on the **server** (the query key
 * includes `filters`), so `shown` and `total` are the same number: the count
 * reports what came back, and the empty state is what distinguishes a narrow
 * filter from an empty register.
 */
function RegisterFilters({
  filters,
  onChange,
  categories,
  shown,
}: {
  filters: Filters
  onChange: (next: Filters) => void
  categories: Array<{ id: string; name: string }>
  shown: number
}) {
  const active = !!filters.status || !!filters.categoryId || !!filters.q

  return (
    <FilterBar
      search={filters.q ?? ""}
      onSearch={(q) => onChange({ ...filters, q: q || undefined })}
      placeholder="Search tag, name or serial"
      shown={shown}
      total={shown}
      noun={shown === 1 ? "asset" : "assets"}
      active={active}
      onClear={() => onChange({})}
    >
      <FilterSelect
        label="Filter by status"
        value={filters.status ?? ALL}
        onChange={(v) => onChange({ ...filters, status: v === ALL ? undefined : v })}
        allLabel="All statuses"
        options={STATUS_OPTIONS}
      />
      <FilterSelect
        label="Filter by category"
        value={filters.categoryId ?? ALL}
        onChange={(v) => onChange({ ...filters, categoryId: v === ALL ? undefined : v })}
        allLabel="All categories"
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />
    </FilterBar>
  )
}

/**
 * One component, five roles. Branches on `useSession().user.role`, the
 * pattern leave, attendance and payroll already established — never five
 * separate page components.
 */
export function AssetPage() {
  const { accessToken, user, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()

  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const role = user?.role
  const manage = !!role && canManageAssets(role)
  const dispose = !!role && canDispose(role)
  const staff = !!role && isStaff(role)
  const isManagerRole = role === "REPORTING_MANAGER"
  const ownEmployeeCode = user?.employeeCode

  const [filters, setFilters] = useState<Filters>({})
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [disposal, setDisposal] = useState<{ kind: "retire" | "lost"; assetId: string } | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [assignTarget, setAssignTarget] = useState<string | null>(null)
  const [returnTarget, setReturnTarget] = useState<string | null>(null)
  const [repairTarget, setRepairTarget] = useState<string | null>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editAssetId, setEditAssetId] = useState<string | null>(null)
  const [fulfilling, setFulfilling] = useState<AssetRequest | null>(null)
  /** The approved request whose asset is being added, so the dialog can prefill. */
  const [addingFor, setAddingFor] = useState<AssetRequest | null>(null)
  const [showAllRequests, setShowAllRequests] = useState(false)
  /** The request whose history is open in the side sheet. */
  const [viewingRequest, setViewingRequest] = useState<AssetRequest | null>(null)
  const [receiving, setReceiving] = useState<AssetRepair | null>(null)
  const [withdrawing, setWithdrawing] = useState<AssetRequest | null>(null)

  const categoriesQuery = useQuery({
    queryKey: ["asset-categories"],
    queryFn: () => listCategories(accessToken!),
    enabled: isAuthed,
  })

  const registerQuery = useQuery({
    queryKey: ["assets", filters],
    queryFn: () => listAssets(accessToken!, filters),
    enabled: isAuthed && (manage || role === "FINANCE_OFFICER" || isManagerRole),
  })

  /**
   * The register with no filters on it, purely so the requests tab can count
   * free units per category.
   *
   * `registerQuery` is keyed on the Register tab's filters, so reading stock
   * from it meant filtering that tab to (say) "Assigned" silently changed
   * which buttons every approved request offered — one tab quietly editing
   * another. TanStack Query dedupes by key, so whenever the register filters
   * are empty (the normal case) this is the same key and costs no extra
   * request; it only fetches a second time while a filter is actually set.
   */
  const stockQuery = useQuery({
    queryKey: ["assets", {}],
    queryFn: () => listAssets(accessToken!, {}),
    enabled: isAuthed && (manage || role === "FINANCE_OFFICER" || isManagerRole),
  })

  const holdingsQuery = useQuery({
    queryKey: ["assets", "me"],
    queryFn: () => getMyHoldings(accessToken!),
    enabled: isAuthed && staff,
  })

  const unacknowledgedQuery = useQuery({
    queryKey: ["assets", "unacknowledged"],
    queryFn: () => listUnacknowledged(accessToken!),
    enabled: isAuthed && manage,
  })

  const repairsQuery = useQuery({
    queryKey: ["assets", "repairs", "open"],
    queryFn: () => listRepairs(accessToken!, { open: true }),
    enabled: isAuthed && manage,
  })

  const requestsQuery = useQuery({
    queryKey: ["assets", "requests"],
    queryFn: () => listAssetRequests(accessToken!),
    enabled: isAuthed && (manage || staff),
  })

  // Status is derived, so one write can change what several lists say —
  // every mutation below invalidates the whole "assets" prefix, plus the
  // single-asset key when one is in view.
  function invalidateAssets() {
    queryClient.invalidateQueries({ queryKey: ["assets"] })
    if (selectedAssetId) queryClient.invalidateQueries({ queryKey: ["asset", selectedAssetId] })
  }

  function handleError(err: unknown) {
    setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
  }

  const acknowledgeMutation = useMutation({
    mutationFn: (assignmentId: string) => acknowledgeAssignment(accessToken!, assignmentId),
    onSuccess: () => {
      setError(null)
      invalidateAssets()
    },
    onError: handleError,
  })

  /**
   * Records that somebody went shopping. Without it "approved a fortnight ago
   * and forgotten" and "approved and on its way" are the same row.
   *
   * No dialog: the expected-by date and note the endpoint accepts are both
   * optional, and asking for them would put a form in front of a one-word
   * fact. If a date turns out to be wanted here, that is when it earns a form.
   */
  const markOrderedMutation = useMutation({
    mutationFn: (requestId: string) => markAssetRequestOrdered(accessToken!, requestId),
    onSuccess: () => {
      setError(null)
      invalidateAssets()
    },
    onError: handleError,
  })

  const retireMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => retireAsset(accessToken!, id, { note }),
    onSuccess: () => {
      setDisposal(null)
      invalidateAssets()
    },
    onError: handleError,
  })

  const markLostMutation = useMutation({
    mutationFn: ({
      id,
      note,
      recovery,
    }: {
      id: string
      note: string
      recovery?: { amount: string; reason: string }
    }) =>
      markAssetLost(accessToken!, id, {
        note,
        recovery,
      }),
    onSuccess: () => {
      setDisposal(null)
      invalidateAssets()
    },
    onError: handleError,
  })

  // ── the ledger actions (Finance only) ──
  const [capitalisingId, setCapitalisingId] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [disposingId, setDisposingId] = useState<string | null>(null)
  const [disposeTarget, setDisposeTarget] = useState<Asset | null>(null)

  const capitaliseMutation = useMutation({
    mutationFn: (id: string) => capitaliseAsset(accessToken!, id),
    onMutate: (id) => setCapitalisingId(id),
    onSettled: () => setCapitalisingId(null),
    onSuccess: () => {
      setError(null)
      invalidateAssets()
    },
    onError: handleError,
  })

  const payMutation = useMutation({
    mutationFn: (id: string) => payForAsset(accessToken!, id),
    onMutate: (id) => setPayingId(id),
    onSettled: () => setPayingId(null),
    onSuccess: () => {
      setError(null)
      invalidateAssets()
    },
    onError: handleError,
  })

  const disposeMutation = useMutation({
    mutationFn: ({ id, proceeds, note }: { id: string; proceeds?: string; note?: string }) =>
      disposeAsset(accessToken!, id, { proceeds, note }),
    onMutate: () => setDisposingId(disposeTarget?.id ?? null),
    onSettled: () => setDisposingId(null),
    onSuccess: () => {
      setError(null)
      setDisposeTarget(null)
      invalidateAssets()
    },
    onError: handleError,
  })

  const approveRequestMutation = useMutation({
    mutationFn: (id: string) => approveAssetRequest(accessToken!, id),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["assets", "requests"] })
    },
    onError: handleError,
  })

  const rejectRequestMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => rejectAssetRequest(accessToken!, id, { note }),
    onSuccess: () => {
      setRejecting(null)
      queryClient.invalidateQueries({ queryKey: ["assets", "requests"] })
    },
    onError: handleError,
  })

  const withdrawMutation = useMutation({
    mutationFn: (id: string) => cancelAssetRequest(accessToken!, id),
    onSuccess: () => {
      setWithdrawing(null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["assets", "requests"] })
    },
    onError: (err) => {
      setWithdrawing(null)
      handleError(err)
    },
  })

  if (sessionStatus === "loading") {
    return (
      <div className="pt-7">
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const categories = categoriesQuery.data ?? []
  // Filtering happens on the server here, so an empty result means either a
  // narrow filter or an empty register, and only this tells the two apart.
  const filtersActive = !!filters.status || !!filters.categoryId || !!filters.q
  const openRequestCount = (requestsQuery.data ?? []).filter((r) => isRequestOpen(r.stage)).length

  /**
   * Counts are what still needs somebody, never rows in the tab. Register and
   * Import carry none: a register is not a queue, and an importer has nothing
   * outstanding. Recoveries counts only PENDING — a waived or recovered one is
   * closed and must not keep the badge lit.
   */
  const ASSET_TABS = [
    { value: "register", label: "Register", icon: RiArchiveLine, count: 0 },
    { value: "recoveries", label: "Recoveries", icon: RiMoneyDollarCircleLine, count: 0 },
    {
      value: "unacknowledged",
      label: "Unacknowledged",
      icon: RiQuestionMark,
      count: unacknowledgedQuery.data?.length ?? 0,
    },
    {
      value: "repairs",
      label: "Open repairs",
      icon: RiToolsLine,
      count: repairsQuery.data?.length ?? 0,
    },
    { value: "requests", label: "Requests", icon: RiInboxLine, count: openRequestCount },
    { value: "import", label: "Import", icon: RiUploadCloud2Line, count: 0 },
  ]

  // The employee list shows every open request plus the three most recent
  // closed ones. `listRequests` returns their whole history, newest first, and
  // a year of it buried the holdings section underneath.
  const CLOSED_REQUESTS_SHOWN = 3
  const myRequests = requestsQuery.data ?? []
  const myVisibleRequests = showAllRequests
    ? myRequests
    : (() => {
        let closedShown = 0
        return myRequests.filter((r) => {
          if (isRequestOpen(r.stage)) return true
          closedShown += 1
          return closedShown <= CLOSED_REQUESTS_SHOWN
        })
      })()
  const hiddenRequestCount = myRequests.length - myVisibleRequests.length

  const acknowledgingId = acknowledgeMutation.isPending ? (acknowledgeMutation.variables ?? null) : null
  const approvingId = approveRequestMutation.isPending ? (approveRequestMutation.variables ?? null) : null

  return (
    <>
      <PageHeader kicker="Workspace" title="Assets" sub="Company equipment, custody and repairs" />

      {error ? (
        <div className="mb-4">
          <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert>
        </div>
      ) : null}

      {manage ? (
        <div className="space-y-4">
          {/* The filters moved inside the Register tab, where they apply.
              Sitting out here they stayed on screen for all six tabs, so the
              Requests tab offered a "Search tag, name or serial" box, asset
              statuses and a "2 assets" count while showing three requests —
              and typing in that box silently re-queried a register nobody
              could see. "Add asset" stays: it is a global action, and the
              Requests tab is exactly where it gets reached for. */}
          <div className="flex flex-wrap items-start justify-end gap-3">
            <Button type="button" onClick={() => setCreateOpen(true)}>
              Add asset
            </Button>
          </div>

          <Tabs defaultValue="register">
            {/* The same underline strip the Settings page uses, for the same
                reason: the sidebar already owns a filled-pill nav, so a second
                filled treatment inside the page reads as a competing
                hierarchy. The default boxed TabsList also pins itself to h-8
                and overflowed at six items, which is where the scroll arrows
                came from. */}
            <TabsList
              variant="line"
              /* `h-auto!` is load-bearing: the primitive pins a horizontal list
                 to `h-8` via `group-data-horizontal/tabs:h-8`, which outranks a
                 plain utility on specificity. */
              className="h-auto! w-full justify-start gap-6 overflow-x-auto rounded-none border-b border-[#E4E9EF] bg-transparent p-0"
            >
              {ASSET_TABS.map(({ value, label, icon: Icon, count }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="h-auto flex-none gap-2 rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 text-[13px] font-semibold text-[#5F6B7C] transition-colors after:hidden hover:text-[#1C2733] data-active:border-b-[#17191C] data-active:bg-transparent data-active:text-[#1C2733]"
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {label}
                  {/* A count is a quantity, not part of the name, so it reads
                      as a pill rather than "(3)" glued to the label. */}
                  {count ? (
                    <span className="rounded-full bg-[#EEF1F5] px-1.5 py-px text-[11px] font-bold text-[#5F6B7C] tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="recoveries" className="pt-3">
              <RecoveriesTab />
            </TabsContent>

            <TabsContent value="register" className="space-y-3 pt-3">
              <RegisterFilters
                filters={filters}
                onChange={setFilters}
                categories={categories}
                shown={registerQuery.data?.length ?? 0}
              />
              <AssetTable
                assets={registerQuery.data ?? []}
                isLoading={registerQuery.isPending}
                isError={registerQuery.isError}
                onRetry={() => registerQuery.refetch()}
                onView={setSelectedAssetId}
                onEdit={setEditAssetId}
                emptyTitle={filtersActive ? "No assets match" : "The register is empty"}
                emptyBody={
                  filtersActive
                    ? "Nothing in the register matches this search and these filters together."
                    : "Add the first asset, or bring the existing register in from a spreadsheet on the Import tab."
                }
                emptyAction={filtersActive ? "Clear filters" : "Add asset"}
                onEmptyAction={filtersActive ? () => setFilters({}) : () => setCreateOpen(true)}
              />
            </TabsContent>

            <TabsContent value="unacknowledged" className="pt-3">
              <UnacknowledgedTable
                assignments={unacknowledgedQuery.data ?? []}
                isLoading={unacknowledgedQuery.isPending}
                isError={unacknowledgedQuery.isError}
                onRetry={() => unacknowledgedQuery.refetch()}
              />
            </TabsContent>

            <TabsContent value="repairs" className="pt-3">
              <RepairsTable
                repairs={repairsQuery.data ?? []}
                isLoading={repairsQuery.isPending}
                isError={repairsQuery.isError}
                onRetry={() => repairsQuery.refetch()}
                onReceive={manage ? setReceiving : undefined}
              />
            </TabsContent>

            <TabsContent value="requests" className="pt-3">
              <RequestsTable
                requests={requestsQuery.data ?? []}
                // Deliberately not `?? []`: undefined means the register is
                // not known yet, which is not the same claim as "nothing is
                // free". Also deliberately not `registerQuery` — that one
                // carries the Register tab's filters.
                assets={stockQuery.data}
                isLoading={requestsQuery.isPending}
                isError={requestsQuery.isError}
                onRetry={() => requestsQuery.refetch()}
                ownEmployeeCode={ownEmployeeCode}
                canDecide
                onApprove={(id) => approveRequestMutation.mutate(id)}
                onReject={(id) => {
                  setError(null)
                  setRejecting(id)
                }}
                onView={setViewingRequest}
                onFulfil={setFulfilling}
                onAddAsset={setAddingFor}
                onMarkOrdered={(r) => markOrderedMutation.mutate(r.id)}
                onWithdraw={staff ? setWithdrawing : undefined}
                approvingId={approvingId}
                emptyTitle="No requests yet"
                emptyBody="Requests raised by staff land here for a decision, and stay until one is handed over."
              />
            </TabsContent>

            <TabsContent value="import" className="pt-3">
              <ImportWizard onImported={invalidateAssets} />
            </TabsContent>
          </Tabs>
        </div>
      ) : null}

      {!manage && role === "FINANCE_OFFICER" ? (
        <div className="space-y-4">
          <RegisterFilters
            filters={filters}
            onChange={setFilters}
            categories={categories}
            shown={registerQuery.data?.length ?? 0}
          />
          <FinanceAssetTable
            assets={registerQuery.data ?? []}
            isLoading={registerQuery.isPending}
            isError={registerQuery.isError}
            onRetry={() => registerQuery.refetch()}
            onView={setSelectedAssetId}
            onCapitalise={(id) => capitaliseMutation.mutate(id)}
            onPay={(id) => payMutation.mutate(id)}
            onDispose={(id) => {
              const asset = registerQuery.data?.find((a) => a.id === id)
              if (asset) setDisposeTarget(asset)
            }}
            capitalisingId={capitalisingId}
            payingId={payingId}
            disposingId={disposingId}
            emptyTitle={filtersActive ? "No assets match" : "The register is empty"}
            emptyBody={
              filtersActive
                ? "Nothing in the register matches this search and these filters together."
                : "Nothing has been added to the asset register yet."
            }
            emptyAction={filtersActive ? "Clear filters" : "Reload"}
            onEmptyAction={filtersActive ? () => setFilters({}) : () => registerQuery.refetch()}
          />
        </div>
      ) : null}

      {isManagerRole ? (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[15px] font-bold">What I&apos;m holding</div>
              <Button type="button" size="sm" variant="outline" onClick={() => setRequestOpen(true)}>
                Request an asset
              </Button>
            </div>
            <HoldingsTable
              assignments={holdingsQuery.data ?? []}
              isLoading={holdingsQuery.isPending}
              isError={holdingsQuery.isError}
              onRetry={() => holdingsQuery.refetch()}
              onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
              acknowledgingId={acknowledgingId}
            />
          </section>

          <section>
            <SectionTitle>My team&apos;s holdings</SectionTitle>
            <AssetTable
              assets={registerQuery.data ?? []}
              isLoading={registerQuery.isPending}
              isError={registerQuery.isError}
              onRetry={() => registerQuery.refetch()}
              onView={setSelectedAssetId}
              emptyTitle="Nobody on your team holds an asset"
              emptyBody="Anything assigned to someone reporting to you appears here."
              emptyAction="Refresh"
              onEmptyAction={() => registerQuery.refetch()}
            />
          </section>

          <section>
            <SectionTitle>Approvals</SectionTitle>
            <RequestsTable
              requests={requestsQuery.data ?? []}
              isLoading={requestsQuery.isPending}
              isError={requestsQuery.isError}
              onRetry={() => requestsQuery.refetch()}
              ownEmployeeCode={ownEmployeeCode}
              canDecide
              onApprove={(id) => approveRequestMutation.mutate(id)}
              onReject={(id) => {
                setError(null)
                setRejecting(id)
              }}
              onView={setViewingRequest}
              // No onFulfil: handing an asset over is HR / Super Admin on the
              // server, so a manager approving is where their part ends.
              onWithdraw={setWithdrawing}
              approvingId={approvingId}
              emptyTitle="Nothing needs your decision"
              emptyBody="Requests from your team appear here until you approve or reject them."
            />
          </section>
        </div>
      ) : null}

      {role === "EMPLOYEE" ? (
        <div className="space-y-6">
          {/* Requests lead, holdings follow. Most people hold one or two
              things and have no reason to look at them; what brings somebody
              to this page is asking for something, or chasing what they
              already asked for. The button moved up with the section it
              belongs to. */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="text-[15px] font-bold">My requests</div>
              <Button type="button" size="sm" variant="outline" onClick={() => setRequestOpen(true)}>
                Request an asset
              </Button>
            </div>
            <RequestsTable
              requests={myVisibleRequests}
              isLoading={requestsQuery.isPending}
              isError={requestsQuery.isError}
              onRetry={() => requestsQuery.refetch()}
              ownEmployeeCode={ownEmployeeCode}
              canDecide={false}
              onApprove={() => {}}
              onReject={() => {}}
              onView={setViewingRequest}
              // The requester's own way out. Without it a request typed by
              // mistake sat in somebody's queue until they rejected it.
              onWithdraw={setWithdrawing}
              approvingId={null}
              emptyTitle="You have not requested anything"
              emptyBody="Use Request an asset above, and the decision appears here."
            />
            {/* Below md every row becomes its own card, so an unbounded
                history would push "What I'm holding" — and the Acknowledge
                button on it — far below the fold on the phone most employees
                use. Open requests always show; closed ones are capped until
                asked for. */}
            {hiddenRequestCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowAllRequests(true)}
                className="mt-2 text-[12.5px] font-semibold text-[#3A6FF8] underline-offset-2 hover:underline"
              >
                Show {hiddenRequestCount} earlier request{hiddenRequestCount === 1 ? "" : "s"}
              </button>
            ) : null}
          </section>

          <section>
            <SectionTitle>What I&apos;m holding</SectionTitle>
            <HoldingsTable
              assignments={holdingsQuery.data ?? []}
              isLoading={holdingsQuery.isPending}
              isError={holdingsQuery.isError}
              onRetry={() => holdingsQuery.refetch()}
              onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
              acknowledgingId={acknowledgingId}
            />
          </section>

          <section>
            <SectionTitle>Asset recoveries</SectionTitle>
            <MyRecoveries />
          </section>
        </div>
      ) : null}

      <AssetDetail
        assetId={selectedAssetId}
        open={!!selectedAssetId}
        onOpenChange={(next) => !next && setSelectedAssetId(null)}
        // Assign/return/repair are HR / Super Admin only on the server —
        // Finance and managers view the same sheet with none of these.
        onAssign={manage ? (id) => setAssignTarget(id) : undefined}
        onReturn={manage ? (id) => setReturnTarget(id) : undefined}
        onSendRepair={manage ? (id) => setRepairTarget(id) : undefined}
        onRetire={dispose ? (id) => setDisposal({ kind: "retire", assetId: id }) : undefined}
        // Mark-lost is HR/Super Admin only on the server — Finance can retire
        // but not accuse an asset of being lost.
        onMarkLost={manage ? (id) => setDisposal({ kind: "lost", assetId: id }) : undefined}
        onAcknowledge={staff ? (assignmentId) => acknowledgeMutation.mutate(assignmentId) : undefined}
        acknowledgePending={acknowledgeMutation.isPending}
      />

      {/* Read-only, so it is mounted for every role. The actions all stay on
          the row, which keeps one owner for the mutations and the query
          invalidation they need. */}
      <RequestDetail
        request={viewingRequest}
        open={!!viewingRequest}
        onOpenChange={(next) => !next && setViewingRequest(null)}
      />

      <CreateAssetDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={invalidateAssets}
      />

      {/* Adding the thing an approved request asked for. Keyed on the request
          so re-opening for a different row re-seeds the category. Saving does
          NOT assign it: approving and buying are separate moments, and the
          handover stays a distinct act so the register records who issued it
          and in what condition. */}
      <CreateAssetDialog
        key={addingFor?.id ?? "add-for-idle"}
        open={!!addingFor}
        prefillCategoryId={addingFor?.categoryId ?? undefined}
        requestedBy={addingFor?.employee?.fullName ?? undefined}
        onOpenChange={(next) => !next && setAddingFor(null)}
        onSuccess={() => {
          setAddingFor(null)
          invalidateAssets()
        }}
      />

      {/* Keyed so switching target asset remounts and re-seeds the form. */}
      <CreateAssetDialog
        key={editAssetId ?? "edit-idle"}
        open={!!editAssetId}
        assetId={editAssetId}
        onOpenChange={(next) => !next && setEditAssetId(null)}
        onSuccess={invalidateAssets}
        // Closed first, deliberately: the two dialogs would otherwise stack,
        // and any unsaved edits behind the handover form would be discarded on
        // its success anyway, without the reader being told.
        onHandOver={
          manage
            ? (id) => {
                setEditAssetId(null)
                setAssignTarget(id)
              }
            : undefined
        }
        onReturn={
          manage
            ? (id) => {
                setEditAssetId(null)
                setReturnTarget(id)
              }
            : undefined
        }
      />

      <AssignDialog
        assetId={assignTarget}
        open={!!assignTarget}
        onOpenChange={(next) => !next && setAssignTarget(null)}
        onSuccess={invalidateAssets}
      />

      <ReturnDialog
        assetId={returnTarget}
        open={!!returnTarget}
        onOpenChange={(next) => !next && setReturnTarget(null)}
        onSuccess={invalidateAssets}
      />

      <RepairDialog
        assetId={repairTarget}
        open={!!repairTarget}
        onOpenChange={(next) => !next && setRepairTarget(null)}
        onSuccess={invalidateAssets}
      />

      {staff ? (
        <RequestDialog
          open={requestOpen}
          onOpenChange={setRequestOpen}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["assets", "requests"] })}
        />
      ) : null}

      <FulfilDialog
        request={fulfilling}
        onOpenChange={(next) => !next && setFulfilling(null)}
        onSuccess={invalidateAssets}
      />

      <ReceiveRepairDialog
        repair={receiving}
        onOpenChange={(next) => !next && setReceiving(null)}
        onSuccess={invalidateAssets}
      />

      <DisposeDialog
        open={!!disposeTarget}
        onOpenChange={(next) => !next && setDisposeTarget(null)}
        asset={disposeTarget}
        pending={disposeMutation.isPending}
        error={disposeMutation.isError ? error : null}
        onConfirm={({ proceeds, note }) => {
          if (disposeTarget) disposeMutation.mutate({ id: disposeTarget.id, proceeds, note })
        }}
      />

      <ConfirmDialog
        open={!!withdrawing}
        title="Withdraw this request?"
        body={
          withdrawing
            ? `Your request for ${withdrawing.category?.name ?? "an asset"} will be cancelled and leave the approver's queue. You can raise it again.`
            : ""
        }
        confirmLabel="Withdraw request"
        pending={withdrawMutation.isPending}
        onCancel={() => setWithdrawing(null)}
        onConfirm={() => withdrawing && withdrawMutation.mutate(withdrawing.id)}
      />

      {dispose ? (
        <LifecycleRecoveryDialog
          // Remounts per target so the fields never carry over from the last
          // asset. The idle key is namespaced because the reject dialog below
          // is a sibling — HR sees both, and a shared "none" collides.
          key={disposal ? `${disposal.kind}-${disposal.assetId}` : "disposal-idle"}
          open={!!disposal}
          onOpenChange={(next) => !next && setDisposal(null)}
          kind={disposal?.kind === "lost" ? "lost" : "retire"}
          pending={retireMutation.isPending || markLostMutation.isPending}
          error={error}
          onConfirm={({ note, recovery }) => {
            if (!disposal) return
            if (disposal.kind === "retire") retireMutation.mutate({ id: disposal.assetId, note })
            else markLostMutation.mutate({ id: disposal.assetId, note, recovery })
          }}
        />
      ) : null}

      {manage || isManagerRole ? (
        <DecisionDialog
          key={rejecting ? `reject-${rejecting}` : "reject-idle"}
          open={!!rejecting}
          onOpenChange={(next) => !next && setRejecting(null)}
          title="Reject this request"
          confirmLabel="Reject request"
          pending={rejectRequestMutation.isPending}
          error={error}
          onConfirm={(note) => {
            if (rejecting) rejectRequestMutation.mutate({ id: rejecting, note })
          }}
        />
      ) : null}
    </>
  )
}
