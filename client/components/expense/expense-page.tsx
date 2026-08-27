"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"
import {
  RiCheckboxCircleLine,
  RiComputerLine,
  RiCupLine,
  RiFirstAidKitLine,
  RiGraduationCapLine,
  RiMoneyDollarCircleLine,
  RiPencilRuler2Line,
  RiReceiptLine,
  RiTaxiLine,
  RiTimeLine,
  RiWalletLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import { ApiError } from "@/lib/api/client"
import {
  approveExpenseClaim,
  createExpenseClaim,
  uploadClaimReceipt,
  getExpenseReport,
  getMyExpenseClaims,
  listExpenseClaims,
  listExpenseCategories,
  rejectExpenseClaim,
  updateExpenseClaim,
  deleteExpenseClaim,
} from "@/lib/api/expenses"
import { useSession } from "@/lib/auth/session-context"
import type {
  Currency,
  ExpenseClaim,
  ExpenseClaimInput,
  ExpenseReport,
  ExpenseStatus,
} from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { toDateString } from "@/lib/utils"
import { ConfirmDialog } from "@/components/dashboard/record-kit"
import { DataTable } from "@/components/dashboard/data-table"
import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DecisionDialog } from "@/components/leave/decision-dialog"
import { ExpenseDialog } from "@/components/expense/expense-dialog"
import { ExpenseReports } from "@/components/expense/expense-report-panel"
import {
  EXPENSE_STATUS_LABEL,
  EXPENSE_STATUS_TONE,
  FINANCE_ROLES,
  PAYROLL_ADMIN_ROLES,
  STAFF_ROLES,
} from "@/components/payroll/payroll-shared"

/** `2026-07-06T00:00:00.000Z` → `6 Jul 2026`. */
function spendDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/**
 * A glyph per category, keyed on `code` rather than `name`.
 *
 * Categories are created by Finance at runtime, so this is deliberately
 * partial and falls back to a receipt: an unmapped category gets a sensible
 * generic glyph, never a question-mark box, and Finance adding "Gas bill"
 * tomorrow does not render a hole.
 */
const CATEGORY_ICON: Record<string, RemixiconComponentType> = {
  TRAVEL: RiTaxiLine,
  CONVEYANCE: RiTaxiLine,
  ENTERTAINMENT: RiCupLine,
  STATIONERY: RiPencilRuler2Line,
  IT: RiComputerLine,
  MEDICAL: RiFirstAidKitLine,
  TRAINING: RiGraduationCapLine,
}
const categoryIcon = (code: string) => CATEGORY_ICON[code.toUpperCase()] ?? RiReceiptLine

/**
 * The claim, as one cell: what it was, then the category and the note under it.
 *
 * A `node` rather than `text`/`sub`, because the kit's `sub` is a single
 * nowrap truncated line and a description clipped to "Bought a replacement
 * water jar for the…" is a description nobody can read. This wraps to two
 * lines and stops.
 */
function claimCell(claim: ExpenseClaim) {
  const Icon = categoryIcon(claim.category.code)
  const route =
    claim.travelFrom || claim.travelTo
      ? `${claim.travelFrom ?? "?"} → ${claim.travelTo ?? "?"}`
      : null
  // The route is the description for a journey; showing both repeats it.
  const detail = route ?? claim.description

  return {
    node: (
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-[#8A94A2]" aria-hidden />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[#1C2733]">
            {claim.name ?? claim.category.name}
          </div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-[#6B7789]">
            <span>{claim.category.name}</span>
            {detail ? (
              <>
                <span aria-hidden> · </span>
                <span className="line-clamp-2">{detail}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    ),
  }
}

function claimRow(claim: ExpenseClaim, extra: TableCell[]): TableCell[] {
  return [
    // Name, then category and the note under it, behind a category glyph.
    // `name` is null only on claims filed before the field existed, and those
    // fall back to the category so no row is ever unlabelled.
    claimCell(claim),
    // Was the raw `expenseDate`, which rendered as
    // "2026-07-06T00:00:00.000Z" — the API sends a full ISO timestamp and
    // this cell printed it verbatim.
    { text: spendDate(claim.expenseDate) },
    { text: formatMoney(claim.amount, claim.currency) },
    { tag: EXPENSE_STATUS_LABEL[claim.status], tone: EXPENSE_STATUS_TONE[claim.status] },
    ...extra,
  ]
}

export function ExpensePage() {
  const { accessToken, user, status } = useSession()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [editing, setEditing] = useState<ExpenseClaim | null>(null)
  const [deleting, setDeleting] = useState<ExpenseClaim | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isAuthed = status === "authenticated" && !!accessToken
  const isStaff = !!user && STAFF_ROLES.includes(user.role)
  const isReviewer = !!user && FINANCE_ROLES.includes(user.role)
  const isAdmin = !!user && PAYROLL_ADMIN_ROLES.includes(user.role)

  const mineQuery = useQuery({
    queryKey: ["expenses", "me"],
    queryFn: () => getMyExpenseClaims(accessToken!),
    enabled: isAuthed && isStaff,
  })

  const allQuery = useQuery({
    queryKey: ["expenses", "all"],
    queryFn: () => listExpenseClaims(accessToken!),
    enabled: isAuthed && isAdmin,
  })
  const categoriesQuery = useQuery({ queryKey: ["expense-categories"], queryFn: () => listExpenseCategories(accessToken!), enabled: isAuthed })

  /**
   * This month's figures, for the tiles at the top.
   *
   * Fetched from the report endpoint rather than summed from `mine`, and that
   * is not a preference: money is Decimal on the server and travels as
   * strings, so the client formats and never does arithmetic on it. Adding
   * `Number(claim.amount)` across a page of rows is exactly the float rounding
   * PRODUCT.md forbids — and it would silently add BDT to USD, which no amount
   * of care in the browser can make true.
   *
   * The endpoint scopes an employee to their own claims regardless of what is
   * asked for, so this needs no `employeeId` and cannot leak anybody else's.
   */
  const monthRange = useMemo(() => {
    const now = new Date()
    return {
      from: toDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
      to: toDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      label: now.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
    }
  }, [])

  const monthQuery = useQuery({
    queryKey: ["expenses", "report", monthRange.from, monthRange.to, "self"],
    queryFn: () => getExpenseReport(accessToken!, { from: monthRange.from, to: monthRange.to }),
    enabled: isAuthed && isStaff,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["expenses"] })
  }

  function handleError(err: unknown) {
    setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
  }

  /**
   * Create, then attach.
   *
   * Two steps, because a receipt is stored under its claim's own folder and
   * the server checks ownership against the claim — so there is nothing to
   * attach to until the claim has an id.
   *
   * A failed upload does **not** fail the claim. The claim is already saved
   * and valid; losing it because Cloudinary was slow would be the worse
   * outcome, and the message says exactly which half went wrong so the person
   * knows to re-attach rather than re-submit.
   */
  const createMutation = useMutation({
    mutationFn: async ({ input, receipt }: { input: ExpenseClaimInput; receipt: File | null }) => {
      const claim = await createExpenseClaim(accessToken!, input)
      if (!receipt) return { claim, receiptError: null as string | null }
      try {
        await uploadClaimReceipt(accessToken!, claim.id, receipt)
        return { claim, receiptError: null as string | null }
      } catch (err) {
        const why = err instanceof ApiError ? err.message : "the upload failed"
        return {
          claim,
          receiptError: `Your claim was saved, but the receipt was not attached — ${why}. Open the claim to try again.`,
        }
      }
    },
    onSuccess: ({ receiptError }) => {
      setError(receiptError)
      setOpen(false)
      invalidate()
    },
    onError: handleError,
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveExpenseClaim(accessToken!, id),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    // A missing rate for the spend date 409s here; the server's message says
    // which currency and date, which a generic fallback would hide.
    onError: handleError,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ExpenseClaimInput }) =>
      updateExpenseClaim(accessToken!, id, {
        ...input,
        // An omitted key means "leave it" server-side, so clearing a note has
        // to be an explicit null rather than an absent field.
        description: input.description ?? null,
      }),
    onSuccess: () => {
      setError(null)
      setEditing(null)
      invalidate()
    },
    onError: handleError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteExpenseClaim(accessToken!, id),
    onSuccess: () => {
      setError(null)
      setDeleting(null)
      invalidate()
    },
    onError: handleError,
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      rejectExpenseClaim(accessToken!, id, note),
    onSuccess: () => {
      setError(null)
      setRejecting(null)
      invalidate()
    },
    onError: handleError,
  })

  /**
   * The people the report filter can offer, derived from the claims already
   * loaded rather than from a second employee fetch. It is exactly the right
   * set — somebody with no claims has nothing to report on — and it costs no
   * extra request.
   *
   * Above the `isAuthed` early return, with every other hook: a hook after a
   * conditional return is called in a different order on the render where the
   * session resolves, which is a React error rather than a style point.
   */
  const reviewPeople = useMemo(() => {
    const seen = new Map<string, NonNullable<ExpenseClaim["employee"]>>()
    for (const claim of allQuery.data ?? []) {
      if (claim.employee) seen.set(claim.employee.id, claim.employee)
    }
    return [...seen.values()].sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [allQuery.data])

  if (!isAuthed) return <Skeleton className="h-64 w-full" />

  const mine = mineQuery.data ?? []
  const all = allQuery.data ?? []

  const mineRows: TableCell[][] = mine.map((claim) =>
    claimRow(claim, [
      {
        // Which payslip paid it — that link is what makes REIMBURSED
        // checkable rather than a label somebody set.
        text: claim.payslip?.payslipNo ?? (claim.settlementId ? "On settlement" : "—"),
        sub: claim.reviewNote ?? undefined,
      },
      // Only while PENDING, matching the server. Once Finance has decided,
      // the figures are the basis of that decision — showing controls that
      // would 409 is a control that cannot do anything.
      claim.status === "PENDING"
        ? {
            node: (
              <div className="flex justify-end gap-2 whitespace-nowrap">
                <Button
                  variant="link"
                  className="h-auto p-0 text-[12.5px] font-semibold underline"
                  onClick={() => setEditing(claim)}
                >
                  Edit
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-[12.5px] font-semibold text-[#B03A3A] underline"
                  onClick={() => setDeleting(claim)}
                >
                  Delete
                </Button>
              </div>
            ),
          }
        : { text: "" },
    ])
  )

  const reviewRows: TableCell[][] = all.map((claim) =>
    claimRow(claim, [
      { text: claim.employee?.fullName ?? "—", sub: claim.employee?.employeeCode },
      isReviewer && claim.status === "PENDING"
        ? {
            node: (
              <div className="flex gap-2">
                <Button
                  variant="link" className="h-auto p-0 text-[12.5px] font-semibold underline disabled:opacity-50"
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate(claim.id)}
                >
                  Approve
                </Button>
                <Button
                  variant="link" className="h-auto p-0 text-[12.5px] font-semibold underline"
                  onClick={() => setRejecting(claim.id)}
                >
                  Reject
                </Button>
              </div>
            ),
          }
        : { text: claim.payslip?.payslipNo ?? "—" },
    ])
  )

  return (
    <>
      {/* Named for who is reading it. An employee's own claims are just
          "Expenses"; an administrator has a second expenses module for the
          company's own costs, so theirs has to say whose these are. */}
      <PageHeader
        kicker="Workspace"
        title={isAdmin ? "Employee expenses" : "Expenses"}
        sub={
          isAdmin
            ? "Claims submitted by staff — approvals and reimbursements"
            : "Claims, approvals and reimbursements"
        }
      />

      {error ? (
        <div className="mb-4 rounded-md border border-[#F0D9D9] bg-[#FDF6F6] px-5 py-3.5 text-[12.5px] text-[#B03A3A]">
          {error}
        </div>
      ) : null}

      <div className="space-y-6">
        {isStaff ? <MonthStats query={monthQuery} label={monthRange.label} /> : null}

        {isStaff ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-[15px] font-bold">My claims</div>
              <Button onClick={() => setOpen(true)}>Claim an expense</Button>
            </div>

            {mineQuery.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : mine.length === 0 ? (
              <div className="rounded-md border border-[#E4E9EF] bg-white p-5.5 text-[13px] text-[#7A8698]">
                You have no expense claims yet.
              </div>
            ) : (
              <DataTable
                title="My claims"
                cols="1.4fr 0.8fr 0.9fr 0.8fr 0.9fr 0.9fr"
                headers={["Expense", "Spent on", "Amount", "Status", "Paid by", ""]}
                rows={mineRows}
                action={`${mine.length} claim${mine.length === 1 ? "" : "s"}`}
              />
            )}
          </div>
        ) : null}

        {isAdmin ? (
          <div className="space-y-4">
            <div className="text-[15px] font-bold">All claims</div>
            {allQuery.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : all.length === 0 ? (
              <div className="rounded-md border border-[#E4E9EF] bg-white p-5.5 text-[13px] text-[#7A8698]">
                No expense claims have been submitted.
              </div>
            ) : (
              <DataTable
                title="Review queue"
                cols="1.2fr 0.9fr 0.9fr 0.8fr 1.1fr 1fr"
                headers={["Expense", "Spent on", "Amount", "Status", "Employee", ""]}
                rows={reviewRows}
                action={`${all.length} claim${all.length === 1 ? "" : "s"}`}
              />
            )}
          </div>
        ) : null}

        {/*
          Administrators only. It was shown to everyone, on the reasoning that
          the server scopes staff to their own claims anyway — true, but not
          the point: reporting is an administrative act, and a staff member
          looking at their own five rows does not need a date-range report
          under them to do it. Their claims are already on this page.
        */}
        {isAdmin ? (
          <div className="space-y-4">
            <div>
              <div className="text-[15px] font-bold">Reports</div>
              <p className="mt-1 text-[12.5px] text-[#5F6B7C]">
                Claims for any date range, by person or across everybody, as a PDF or a
                spreadsheet.
              </p>
            </div>
            <ExpenseReports accessToken={accessToken!} people={reviewPeople} />
          </div>
        ) : null}
      </div>

      {open ? (
        <ExpenseDialog
          key="expense-new"
          open={open}
          onOpenChange={setOpen}
          pending={createMutation.isPending}
          error={error}
          onSubmit={(input, receipt) => createMutation.mutate({ input, receipt })}
          categories={categoriesQuery.data ?? []}
        />
      ) : null}

      {/* Keyed by claim, so opening a second one after a first re-seeds the
          form rather than showing the previous claim's values. */}
      {editing ? (
        <ExpenseDialog
          key={`expense-edit-${editing.id}`}
          open={!!editing}
          onOpenChange={(next) => !next && setEditing(null)}
          pending={updateMutation.isPending}
          error={error}
          existing={editing}
          // The receipt is ignored on edit — the dialog hides the field, and
          // attaching runs through its own endpoint against the saved claim.
          onSubmit={(input) => updateMutation.mutate({ id: editing.id, input })}
          categories={categoriesQuery.data ?? []}
        />
      ) : null}

      {deleting ? (
        <ConfirmDialog
          open={!!deleting}
          title="Withdraw this claim?"
          // Names the claim and says what goes with it. "Are you sure?" over a
          // list of near-identical rows is how the wrong one gets deleted.
          body={`"${deleting.name ?? deleting.category.name}" for ${formatMoney(deleting.amount, deleting.currency)} will be removed, along with any receipt attached to it. This cannot be undone.`}
          confirmLabel="Withdraw claim"
          pending={deleteMutation.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
        />
      ) : null}

      {rejecting ? (
        <DecisionDialog
          key={`reject-${rejecting}`}
          open={!!rejecting}
          onOpenChange={(next) => !next && setRejecting(null)}
          title="Reject this claim"
          confirmLabel="Reject"
          pending={rejectMutation.isPending}
          error={error}
          onConfirm={(note) => rejectMutation.mutate({ id: rejecting, note })}
        />
      ) : null}
    </>
  )
}

/**
 * This month, in four figures.
 *
 * Every number here comes off the server's `totals`. None is recomputed in the
 * browser, and none is added across currencies — a person who claimed in both
 * sees both, because a single blended figure would be wrong in a way nobody
 * could see.
 *
 * The four answer the questions an employee actually arrives with, in order:
 * what did I spend, what is stuck, what is owed to me, and what has been paid.
 */
function MonthStats({
  query,
  label,
}: {
  query: UseQueryResult<ExpenseReport>
  label: string
}) {
  // Three states, kept apart. A failed request that rendered as zeros would be
  // the worst possible lie on a page about money.
  if (query.isPending) {
    return (
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[86px] w-full rounded-md" />
        ))}
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <div className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4 text-[12.5px] text-[#B03A3A]">
        This month&apos;s totals could not be loaded.{" "}
        <Button
          variant="link"
          className="h-auto p-0 text-[12.5px] font-semibold underline"
          onClick={() => query.refetch()}
        >
          Retry
        </Button>
      </div>
    )
  }

  const { totals } = query.data
  const statusOf = (status: ExpenseStatus) => totals.byStatus.find((s) => s.status === status)

  /**
   * One line per currency, or an em dash when there is nothing.
   *
   * A dash rather than "৳0.00": zero claimed and no claims are the same fact
   * here, and inventing a currency to render a nought in would mean picking
   * one, which the data does not support.
   */
  const money = (list: { currency: Currency; amount: string }[]) =>
    list.length === 0 ? "—" : list.map((c) => formatMoney(c.amount, c.currency)).join("  ·  ")

  const pending = statusOf("PENDING")
  const approved = statusOf("APPROVED")
  const reimbursed = statusOf("REIMBURSED")

  const tiles = [
    {
      label: "Claimed this month",
      value: money(totals.byCurrency),
      sub: `${totals.claims} claim${totals.claims === 1 ? "" : "s"} in ${label}`,
      icon: RiWalletLine,
    },
    {
      label: "Awaiting approval",
      value: money(pending?.byCurrency ?? []),
      sub: pending ? `${pending.claims} waiting on Finance` : "Nothing waiting",
      icon: RiTimeLine,
    },
    {
      label: "Approved, not yet paid",
      value: money(approved?.byCurrency ?? []),
      sub: approved ? `${approved.claims} on the next run` : "Nothing outstanding",
      icon: RiCheckboxCircleLine,
    },
    {
      label: "Reimbursed",
      value: money(reimbursed?.byCurrency ?? []),
      sub: reimbursed ? `${reimbursed.claims} paid back` : "Nothing paid yet",
      icon: RiMoneyDollarCircleLine,
    },
  ]

  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <MiniStat key={tile.label} {...tile} />
      ))}
    </div>
  )
}
