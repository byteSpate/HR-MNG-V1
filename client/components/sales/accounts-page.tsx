"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiAlertLine,
  RiArrowRightLine,
  RiBuilding2Line,
  RiEyeLine,
  RiGroupLine,
} from "@remixicon/react"

import {
  createSalesAccount,
  listAllSalesAccounts,
  listSalesAccounts,
  listSalesEligibleEmployees,
} from "@/lib/api/sales"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { CreateSalesAccountBody, SalesAccountSummary } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import {
  CheckboxField,
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  PanelTable,
  RowActions,
  toMessage,
} from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE } from "@/components/sales/sales-shared"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { TableCell } from "@/components/dashboard/types"

/** 24ms apart, capped at eight rows — a long register must not make row
    forty wait a third of a second to appear. */
const STAGGER_STEP_MS = 24
const STAGGER_MAX_STEPS = 8

function AccountNameCell({
  account,
  delayMs,
  animate,
}: {
  account: SalesAccountSummary
  delayMs: number
  animate: boolean
}) {
  const others = account.assignees.filter((a) => a.id !== account.ownerEmployeeId)
  return (
    <div
      className={animate ? "rise-in min-w-0" : "min-w-0"}
      style={animate ? { animationDelay: `${delayMs}ms` } : undefined}
    >
      <div className="flex items-center gap-1.5">
        <RiBuilding2Line className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
        <span className="truncate font-semibold">{account.name}</span>
      </div>
      {account.industry ? (
        <div className="truncate text-[11.5px] text-[#6B7789]">{account.industry}</div>
      ) : null}
      {others.length > 0 ? (
        <div className="mt-0.5 flex items-center gap-1 text-[11.5px] text-[#6B7789]">
          <RiGroupLine className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{others.map((a) => a.fullName).join(", ")}</span>
        </div>
      ) : null}
    </div>
  )
}

function toRows(accounts: SalesAccountSummary[], animate: boolean): TableCell[][] {
  return accounts.map((a, i) => [
    {
      node: (
        <AccountNameCell
          account={a}
          delayMs={Math.min(i, STAGGER_MAX_STEPS) * STAGGER_STEP_MS}
          animate={animate}
        />
      ),
    },
    {
      node: (
        <div className="min-w-0">
          <div className="truncate">{a.ownerName}</div>
          {/* Revoking access or recording an exit does not reassign the
              account, so an owner can end up unable to work their own
              accounts. Surfaced rather than prevented — see ownerActive. */}
          {!a.ownerActive ? (
            <div className="mt-0.5 flex items-center gap-1 text-[11.5px] font-semibold text-[#8A5E0C]">
              <RiAlertLine className="size-3 shrink-0" aria-hidden />
              Needs a new owner
            </div>
          ) : null}
        </div>
      ),
    },
    { tag: ACCOUNT_STATUS_LABEL[a.status], tone: ACCOUNT_STATUS_TONE[a.status] },
    {
      node: (
        <RowActions
          actions={[
            {
              kind: "link",
              label: a.canManage ? "Open" : "View",
              href: `/sales/accounts/${a.id}`,
              icon: a.canManage ? undefined : <RiEyeLine className="size-3.5" aria-hidden />,
            },
          ]}
        />
      ),
    },
  ])
}

export function AccountsPage({ scope }: { scope: "mine" | "all" }) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()

  const [createOpen, setCreateOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [ownerEmployeeId, setOwnerEmployeeId] = useState("")
  const [industry, setIndustry] = useState("")
  const [website, setWebsite] = useState("")
  const [address, setAddress] = useState("")
  const [assigneeIds, setAssigneeIds] = useState<string[]>([])

  const isAuthed = sessionStatus === "authenticated" && !!accessToken
  const canCreate = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")
  // Whether this login can own an account at all — see sales-shell.tsx for
  // why `employeeCode` is the signal. Distinct from `canCreate`: a Super
  // Admin can create accounts for other people and still never hold one.
  const canOwn = !!user?.employeeCode

  // An administrative login has no employee record, so "My Accounts" can
  // never hold anything for them — the nav already hides it, and reaching
  // the URL directly should land somewhere useful rather than on a page
  // explaining why it is blank. Sales Admins who *do* have an employee
  // record still get the real empty state, because theirs can fill up later.
  const shouldRedirect = scope === "mine" && sessionStatus === "authenticated" && !!user && !canOwn

  useEffect(() => {
    if (shouldRedirect) router.replace("/sales/accounts")
  }, [shouldRedirect, router])

  const accountsQuery = useQuery({
    queryKey: ["sales", "accounts", scope],
    queryFn: () => (scope === "all" ? listAllSalesAccounts(accessToken!) : listSalesAccounts(accessToken!)),
    enabled: isAuthed && !shouldRedirect,
  })

  // Only Sales Admin can open this dialog, and only Sales Admin may call this
  // endpoint — same guard as creating the account itself. Scoped to people
  // who already hold a salesRole: this is the actual fix, not just a nicer
  // picker. Without it the server's own validation was the only thing
  // stopping an account from being handed to someone who could not open the
  // hub to see it.
  const eligibleQuery = useQuery({
    queryKey: ["sales", "eligible-employees"],
    queryFn: () => listSalesEligibleEmployees(accessToken!),
    enabled: isAuthed && createOpen && canCreate,
  })

  function resetForm() {
    setName("")
    setOwnerEmployeeId("")
    setIndustry("")
    setWebsite("")
    setAddress("")
    setAssigneeIds([])
    setFormError(null)
  }

  function handleOpenCreate() {
    resetForm()
    setCreateOpen(true)
  }

  const createMutation = useMutation({
    mutationFn: (body: CreateSalesAccountBody) => createSalesAccount(accessToken!, body),
    onSuccess: () => {
      setCreateOpen(false)
      queryClient.invalidateQueries({ queryKey: ["sales", "accounts"] })
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setFormError(null)

    const missing = [!name.trim() && "a name", !ownerEmployeeId && "an owner"].filter(
      (label): label is string => typeof label === "string"
    )
    if (missing.length > 0) {
      setFormError(`This account needs ${missing.join(" and ")}.`)
      return
    }

    createMutation.mutate({
      name: name.trim(),
      ownerEmployeeId,
      industry: industry.trim() || undefined,
      website: website.trim() || undefined,
      address: address.trim() || undefined,
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
    })
  }

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data])
  const rows = useMemo(() => toRows(accounts, true), [accounts])
  const employees = eligibleQuery.data ?? []
  const isLoading = sessionStatus === "loading" || accountsQuery.isPending

  const title = scope === "all" ? "All Accounts" : "My Accounts"
  const sub =
    scope === "all"
      ? "Every company the team sells to, with an owner answerable for each one. Open one to look, even if it is not yours to work."
      : "The companies you own or are assigned to — the ones you can actually work."

  const emptyTitle = scope === "all" ? "No Sales Accounts yet" : "Nothing here yet"

  // A Sales Admin can create an account but never own one, so "create one"
  // is the wrong prompt for them on this page — the account they made would
  // still belong to somebody else.
  const emptyBody =
    scope === "all"
      ? canCreate
        ? "Create the first one. Once an account exists, its owner and anyone assigned to it can record calls, meetings and deals against it."
        : "A Sales Admin creates the first one. Once an account exists, its owner and anyone assigned to it can record calls, meetings and deals against it."
      : canCreate
        ? // On this page `canCreate` means Sales Admin: a Super Admin never
          // gets here, having been redirected above.
          "Sales Admins manage the hub rather than owning accounts in it, so this list stays empty. All Accounts has everything the team is working."
        : "You don't own or collaborate on any accounts yet. All Accounts has everything the team is working."

  // On All Accounts there is nowhere else to send a Sales User: they cannot
  // create one, and "View All Accounts" would link this page to itself. The
  // copy above already tells them who can create the first account, so the
  // empty state carries no action rather than an inert one.
  const emptyAction = canCreate ? "New Sales Account" : scope === "all" ? undefined : "View All Accounts"

  const goToAll = () => router.push("/sales/accounts")
  const onEmptyAction = canCreate ? handleOpenCreate : goToAll

  // Nothing to paint while the redirect above is in flight — rendering the
  // page first would flash an empty table on the way out.
  if (shouldRedirect) return null

  return (
    <>
      <PageHeader
        kicker="Sales"
        title={title}
        sub={sub}
        cta={canCreate ? "New Sales Account" : undefined}
        onCta={canCreate ? handleOpenCreate : undefined}
      />

      <PanelTable
        cols="minmax(0,2fr) 1fr 1fr auto"
        headers={["Sales Account", "Owner", "Status", ""]}
        rows={rows}
        isLoading={isLoading}
        isError={accountsQuery.isError}
        onRetry={() => accountsQuery.refetch()}
        emptyTitle={emptyTitle}
        emptyBody={emptyBody}
        emptyAction={emptyAction}
        // The default glyph is a plus, which promises a create. This action
        // navigates, so it gets an arrow instead.
        emptyActionIcon={
          emptyAction === "View All Accounts" ? (
            <RiArrowRightLine className="size-4" aria-hidden />
          ) : undefined
        }
        onEmptyAction={onEmptyAction}
      />

      {canCreate ? (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Sales Account</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Name" htmlFor="sa-name">
                <Input id="sa-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>

              {/* Loading, empty and broken are three different states. A
                  failed read used to render as "nobody is available", which
                  is a claim about the company rather than about the request,
                  and offered no way to try again. */}
              {eligibleQuery.isError ? (
                <PanelAlert>
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{toMessage(eligibleQuery.error)}</span>
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => eligibleQuery.refetch()}
                      className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
                    >
                      Try again
                    </Button>
                  </span>
                </PanelAlert>
              ) : null}

              <Field
                label="Owner"
                hint={
                  eligibleQuery.isPending
                    ? "Loading the people who can own an account…"
                    : eligibleQuery.isError
                      ? "This list could not be loaded, so no owner can be chosen yet."
                      : employees.length === 0
                        ? "No Sales User is available yet. Techno Sales Hub access is granted from an employee's record, and only Sales Users can own an account."
                        : "Answerable for this account. Sales Users only — a Sales Admin manages the hub rather than owning accounts in it."
                }
              >
                <Select value={ownerEmployeeId} onValueChange={(v) => setOwnerEmployeeId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string | null) => employees.find((e) => e.id === v)?.fullName ?? "Select an owner"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.fullName} — {e.designation}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Industry" htmlFor="sa-industry" hint="Optional.">
                  <Input id="sa-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} />
                </Field>
                <Field label="Website" htmlFor="sa-website" hint="Optional.">
                  <Input id="sa-website" value={website} onChange={(e) => setWebsite(e.target.value)} />
                </Field>
              </div>

              <Field label="Address" htmlFor="sa-address" hint="Optional.">
                <Input id="sa-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>

              {employees.length > 0 ? (
                <Field
                  label="Collaborators"
                  hint="Optional. Extra people who can work this account besides the owner."
                >
                  <div className="grid max-h-40 gap-0.5 overflow-y-auto rounded-md border border-[#E4E9EF] p-2">
                    {employees
                      .filter((e) => e.id !== ownerEmployeeId)
                      .map((e) => (
                        <CheckboxField
                          key={e.id}
                          label={e.fullName}
                          checked={assigneeIds.includes(e.id)}
                          onChange={(next) =>
                            setAssigneeIds((prev) =>
                              next ? [...prev, e.id] : prev.filter((id) => id !== e.id)
                            )
                          }
                        />
                      ))}
                  </div>
                </Field>
              ) : null}

              {formError ? <FormError>{formError}</FormError> : null}

              <DialogFooter>
                <DialogActions
                  pending={createMutation.isPending}
                  submitLabel="Create account"
                  disabled={false}
                  onCancel={() => setCreateOpen(false)}
                  onSubmit={() => handleSubmit()}
                />
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
