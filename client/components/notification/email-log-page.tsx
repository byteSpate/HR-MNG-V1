"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { listEmails } from "@/lib/api/emails"
import { useSession } from "@/lib/auth/session-context"
import type { EmailDispatch } from "@/lib/api/types"
import { ALL, FilterSelect } from "@/components/dashboard/filter-bar"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelTable } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import type { TableCell } from "@/components/dashboard/types"
import { Button } from "@/components/ui/button"

/**
 * Every email this server has attempted to send.
 *
 * Super Admin only, enforced server-side: the log carries every recipient
 * address in the company, and Finance has no reason to hold that.
 *
 * **No resend button, deliberately.** The table stores recipient, kind and
 * subject — not the body, and not attachments. A working resend would mean
 * either storing every payslip's contents in a log table or writing a
 * reconstruction branch for all fourteen kinds. A control that cannot do
 * anything is a bug; resending stays on the page that owns the thing.
 */

/**
 * The kinds that are actually sent today. `EMAIL_CHANGE_CODE` and
 * `EMAIL_CHANGE_WARNING` exist in the server's `DispatchKind` union but
 * nothing emits them yet, so they are left out: a filter whose only possible
 * answer is "nothing" is a control that cannot do anything.
 */
const KIND_OPTIONS = [
  { value: "PAYSLIP", label: "Payslips" },
  { value: "CREDENTIALS", label: "Account credentials" },
  { value: "PASSWORD_RESET", label: "Password reset" },
  { value: "PASSWORD_CHANGED", label: "Password changed" },
  { value: "LEAVE_REQUESTED", label: "Leave requested" },
  { value: "LEAVE_DECIDED", label: "Leave decided" },
  { value: "EXPENSE_DECIDED", label: "Expense decided" },
  { value: "PAYROLL_SUBMITTED", label: "Payroll submitted" },
  { value: "ASSET_REQUEST_DECIDED", label: "Asset request decided" },
  { value: "SETTLEMENT_STATEMENT", label: "Settlement statement" },
  { value: "ATTENDANCE_DIGEST", label: "Attendance digest" },
  { value: "MISSING_CHECKOUT", label: "Missing check-out" },
]

const KIND_LABELS: Record<string, string> = Object.fromEntries(
  KIND_OPTIONS.map((o) => [o.value, o.label])
)

/** "Aug 17, 10:57 AM" — the same voice the activity page speaks. */
function when(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
}

/**
 * The three states the table actually stores, kept distinct.
 *
 * Collapsing "interrupted" into "failed" would make a crashed dyno
 * indistinguishable from a mail server that refused the message, and the two
 * need different responses.
 */
function statusCell(row: EmailDispatch): TableCell {
  if (row.sentAt) return { node: <Tag label="sent" tone="green" /> }
  if (row.error) return { node: <Tag label="failed" tone="red" />, sub: row.error }
  return { node: <Tag label="interrupted" tone="yellow" /> }
}

function toRows(items: EmailDispatch[]): TableCell[][] {
  return items.map((row) => [
    { text: row.to, weight: 500 },
    { text: KIND_LABELS[row.kind] ?? row.kind.replace(/_/g, " ").toLowerCase() },
    { text: row.subject },
    statusCell(row),
    { text: when(row.createdAt) },
  ])
}

const PAGE_SIZE = 50

export function EmailLogPage() {
  const { accessToken } = useSession()
  // How many pages deep the reader has asked to go. Walking the cursor chain
  // from the top on each change keeps this one query with one cache entry —
  // the same shape the activity page uses over the same kind of endpoint.
  const [pageCount, setPageCount] = useState(1)
  const [kind, setKind] = useState<string>(ALL)
  const [failedOnly, setFailedOnly] = useState(false)

  const filtersActive = kind !== ALL || failedOnly

  const pages = useQuery({
    queryKey: ["emails", pageCount, kind, failedOnly],
    queryFn: async () => {
      const collected: EmailDispatch[] = []
      let cursor: string | undefined
      let nextCursor: string | null = null
      for (let i = 0; i < pageCount; i++) {
        const page = await listEmails(accessToken!, {
          limit: PAGE_SIZE,
          cursor,
          ...(kind === ALL ? {} : { kind }),
          ...(failedOnly ? { failedOnly: true } : {}),
        })
        collected.push(...page.items)
        nextCursor = page.nextCursor
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }
      return { items: collected, nextCursor }
    },
    enabled: !!accessToken,
  })

  function resetTo(next: () => void) {
    // Back to page one on any filter change: keeping the depth would walk a
    // cursor chain that no longer exists.
    setPageCount(1)
    next()
  }

  function clearFilters() {
    resetTo(() => {
      setKind(ALL)
      setFailedOnly(false)
    })
  }

  const items = pages.data?.items ?? []

  return (
    <>
      <PageHeader
        kicker="Administration"
        title="Emails"
        sub="Every email this system has attempted to send, newest first."
      />

      {/* The one line the whole column depends on. "Sent" is the mail
          server's answer, not the reader's inbox, and a column headed
          "Delivered" would claim something nobody here can know. */}
      <p className="mb-4 text-[12.5px] text-[#5F6B7C]">
        Sent means the mail server accepted the message. It is not proof that a person
        received it. There is no resend here — the log stores who and what, not the message
        body, so resending lives on the page that owns the thing.
      </p>

      {/* Hidden while the first page is loading or broken: a count beside a
          skeleton reads as a real answer, and filtering nothing is a control
          that cannot do anything. */}
      {!pages.isPending && !pages.isError ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <FilterSelect
            label="Filter by kind"
            value={kind}
            onChange={(v) => resetTo(() => setKind(v))}
            allLabel="All kinds"
            options={KIND_OPTIONS}
          />
          <Button
            type="button"
            variant={failedOnly ? "default" : "outline"}
            size="sm"
            aria-pressed={failedOnly}
            onClick={() => resetTo(() => setFailedOnly((v) => !v))}
          >
            Failures only
          </Button>
          <span className="text-[12.5px] text-[#5F6B7C] tabular-nums">
            {items.length} {items.length === 1 ? "email" : "emails"}
          </span>
          {filtersActive ? (
            <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}

      <PanelTable
        cols="1.4fr 1fr 1.8fr 0.9fr 1fr"
        headers={["Recipient", "Kind", "Subject", "Sent", "When"]}
        rows={toRows(items)}
        isLoading={pages.isPending}
        isError={pages.isError}
        onRetry={() => pages.refetch()}
        // Two ways to be empty, two different answers: a filter that went too
        // narrow, and a system that has not sent anything yet.
        emptyTitle={filtersActive ? "Nothing matches" : "No emails have been sent yet"}
        emptyBody={
          filtersActive
            ? "No email matches this kind and this status together. Widen one of them."
            : "Emails are recorded here as the system sends them: payslips, account credentials, password resets and the decision notices."
        }
        emptyAction={filtersActive ? "Clear filters" : "Refresh"}
        onEmptyAction={filtersActive ? clearFilters : () => pages.refetch()}
      />

      {pages.data?.nextCursor ? (
        <div className="mt-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPageCount((n) => n + 1)}
          >
            Load older emails
          </Button>
        </div>
      ) : null}
    </>
  )
}
