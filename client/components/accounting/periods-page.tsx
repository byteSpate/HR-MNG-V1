"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiDeleteBinLine, RiLockLine } from "@remixicon/react"
import { toast } from "sonner"

import {
  closePeriod,
  createFinancialYear,
  deleteFinancialYear,
  draftYearEnd,
  listFinancialYears,
  reopenPeriod,
} from "@/lib/api/accounting"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { AccountingPeriod, FinancialYear } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { HelpLink } from "@/components/help/help-link"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  canApprove,
  formatLedgerDate,
  monthLabel,
  PERIOD_STATUS_TONE,
} from "@/components/accounting/accounting-shared"

const TONE_VARIANT = { success: "default", neutral: "secondary", danger: "destructive" } as const

export function PeriodsPage() {
  const { accessToken, user } = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const isAdmin = canApprove(user?.role)

  const [newYearOpen, setNewYearOpen] = useState(false)
  const [startDate, setStartDate] = useState("")
  const [reopening, setReopening] = useState<AccountingPeriod | null>(null)
  const [reason, setReason] = useState("")

  const years = useQuery({
    queryKey: ["accounting", "financial-years"],
    queryFn: () => listFinancialYears(accessToken!),
    enabled: Boolean(accessToken),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["accounting"] })
  const fail = (fallback: string) => (err: unknown) =>
    toast.error(err instanceof ApiError ? err.message : fallback)

  const addYear = useMutation({
    mutationFn: () => createFinancialYear(accessToken!, startDate),
    onSuccess: (fy) => {
      refresh()
      setNewYearOpen(false)
      setStartDate("")
      toast.success(`${fy.name} created with twelve periods`)
    },
    onError: fail("Could not create the financial year"),
  })

  const removeYear = useMutation({
    mutationFn: (id: string) => deleteFinancialYear(accessToken!, id),
    onSuccess: () => {
      refresh()
      toast.success("Financial year deleted")
    },
    onError: fail("Could not delete the financial year"),
  })

  const close = useMutation({
    mutationFn: (id: string) => closePeriod(accessToken!, id),
    onSuccess: () => {
      refresh()
      toast.success("Period closed")
    },
    // The server's refusal names the journals still outstanding, which is the
    // only genuinely useful thing to say here.
    onError: fail("Could not close the period"),
  })

  const reopen = useMutation({
    mutationFn: () => reopenPeriod(accessToken!, reopening!.id, reason),
    onSuccess: () => {
      refresh()
      setReopening(null)
      setReason("")
      toast.success("Period reopened")
    },
    onError: fail("Could not reopen the period"),
  })

  const yearEnd = useMutation({
    mutationFn: (id: string) => draftYearEnd(accessToken!, id),
    onSuccess: (journal) => {
      refresh()
      toast.success(`${journal.journalNo} drafted — review it, then have it approved`)
      router.push(`journals/${journal.id}`)
    },
    onError: fail("Could not draft the year-end journal"),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Accounting"
        title="Financial years & periods"
        sub="A journal's period comes from its date. Closing a month stops anything new landing in it."
        cta="New financial year"
        onCta={() => setNewYearOpen(true)}
      />

      {years.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : years.isError ? (
        <div className="rounded-lg border p-10 text-center text-sm">
          <p className="text-muted-foreground">Financial years could not be loaded.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => years.refetch()}>
            Try again
          </Button>
        </div>
      ) : (years.data ?? []).length === 0 ? (
        <p className="rounded-lg border p-10 text-center text-sm text-muted-foreground">
          No financial year yet. Create one before posting anything — a journal cannot exist
          without a period to fall into.{" "}
          <HelpLink>How does this work?</HelpLink>
        </p>
      ) : (
        <div className="space-y-6">
          {years.data!.map((fy: FinancialYear) => {
            const last = fy.periods[fy.periods.length - 1]
            const readyForYearEnd =
              fy.status === "OPEN" &&
              fy.periods.slice(0, -1).every((p) => p.status !== "OPEN") &&
              last?.status === "OPEN"

            return (
              <section key={fy.id} className="rounded-lg border">
                <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
                  <h2 className="font-medium">{fy.name}</h2>
                  <span className="text-sm text-muted-foreground">
                    {formatLedgerDate(fy.startDate)} – {formatLedgerDate(fy.endDate)}
                  </span>
                  <Badge variant={fy.status === "OPEN" ? "default" : "secondary"}>
                    {fy.status === "OPEN" ? "Open" : "Closed"}
                  </Badge>

                  <div className="ml-auto flex items-center gap-2">
                    {readyForYearEnd && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => yearEnd.mutate(fy.id)}
                        disabled={yearEnd.isPending}
                      >
                        <RiLockLine className="size-4" /> Run year-end
                      </Button>
                    )}
                    {isAdmin && fy.status === "OPEN" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeYear.mutate(fy.id)}
                        aria-label={`Delete ${fy.name}`}
                      >
                        <RiDeleteBinLine className="size-4" />
                      </Button>
                    )}
                  </div>
                </header>

                {fy.status === "OPEN" && !readyForYearEnd && (
                  <p className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                    Year-end becomes available once every month except {last ? monthLabel(last.year, last.month) : "the last"} is
                    closed — the closing entry is dated {formatLedgerDate(fy.endDate)} and has to
                    post into an open period like any other.
                  </p>
                )}

                <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
                  {fy.periods.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 bg-background px-4 py-2.5 text-sm">
                      <span className="w-32">{monthLabel(p.year, p.month)}</span>
                      <Badge variant={TONE_VARIANT[PERIOD_STATUS_TONE[p.status]]}>
                        {p.status === "OPEN" ? "Open" : p.status === "CLOSED" ? "Closed" : "Locked"}
                      </Badge>

                      {isAdmin && (
                        <div className="ml-auto">
                          {p.status === "OPEN" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => close.mutate(p.id)}
                              disabled={close.isPending}
                            >
                              Close
                            </Button>
                          )}
                          {p.status === "CLOSED" && (
                            <Button size="sm" variant="ghost" onClick={() => setReopening(p)}>
                              Reopen
                            </Button>
                          )}
                        </div>
                      )}

                      {p.reopenReason && p.status === "OPEN" && (
                        <span
                          className="ml-auto truncate text-xs text-muted-foreground"
                          title={p.reopenReason}
                        >
                          Reopened — {p.reopenReason}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      <Dialog open={newYearOpen} onOpenChange={setNewYearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New financial year</DialogTitle>
            <DialogDescription>
              Twelve monthly periods are created automatically, all open. The company&apos;s year
              runs 1 July to 30 June.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="fy-start">Starts on</Label>
            <Input
              id="fy-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Must be the first of a month.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewYearOpen(false)}>Cancel</Button>
            <Button onClick={() => addYear.mutate()} disabled={!startDate || addYear.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reopening)} onOpenChange={(o) => !o && setReopening(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reopen {reopening ? monthLabel(reopening.year, reopening.month) : ""}?
            </DialogTitle>
            <DialogDescription>
              Reopening a closed month changes figures that may already have been reported. The
              reason is recorded against the period and is the first thing an auditor will ask
              about.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Late vendor invoice for June"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReopening(null)}>Cancel</Button>
            <Button onClick={() => reopen.mutate()} disabled={!reason.trim() || reopen.isPending}>
              Reopen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
