"use client"

import { useQuery } from "@tanstack/react-query"

import { getNotes } from "@/lib/api/statements"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { currentMonthRange } from "@/components/accounting/accounting-shared"
import { PageHeader } from "@/components/dashboard/page-header"
import { PanelAlert } from "@/components/dashboard/record-kit"
import { Amount } from "@/components/ds/amount"
import { Heading } from "@/components/ds/heading"
import { Text } from "@/components/ds/text"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Notes to the financial statements. Each note lists its accounts with this period's
 * figure and the figure to compare with. On a phone the account name takes a full line
 * and the two figures sit side by side under it, so nothing runs past the screen edge.
 */
export function NotesPage() {
  const { accessToken } = useSession()
  const range = currentMonthRange()
  const q = useQuery({
    queryKey: ["statements", "notes", range],
    queryFn: () => getNotes(accessToken!, range),
    enabled: Boolean(accessToken),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Statements"
        title="Notes to the financial statements"
        sub="Each note lists the accounts behind a number in the statements. Policy notes are written by hand."
      />

      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : q.isError ? (
        <PanelAlert>
          {q.error instanceof ApiError ? q.error.message : "The notes did not load. Please try again."}
        </PanelAlert>
      ) : (
        <div className="space-y-4">
          {q.data.notes.map((n) => (
            <section key={n.ref} className="rounded-lg border p-4">
              <Heading level="card">
                {n.ref} {n.title}
              </Heading>
              {n.body ? (
                <Text variant="muted" className="mt-2 whitespace-pre-line">
                  {n.body}
                </Text>
              ) : null}
              {n.rows.length > 0 ? (
                <div className="mt-3 space-y-2 text-body-sm md:space-y-1">
                  {n.rows.map((r) => (
                    <div
                      key={r.accountId}
                      className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-b border-line pb-2 last:border-0 md:grid-cols-[1fr_140px_140px] md:gap-3 md:border-0 md:pb-0"
                    >
                      <span className="col-span-2 min-w-0 md:col-span-1">
                        {r.code} {r.name}
                      </span>
                      <Amount value={r.current} mode="signed" />
                      <Amount value={r.comparative} mode="signed" tone="muted" />
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
