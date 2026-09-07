"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { createSalesAccount, listSalesAccounts } from "@/lib/api/sales"
import { listEmployees } from "@/lib/api/employees"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { CreateSalesAccountBody, SalesAccountSummary } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { CheckboxField, DialogActions, Field, FormError, PanelTable, RowActions } from "@/components/dashboard/record-kit"
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE } from "@/components/sales/sales-shared"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { TableCell } from "@/components/dashboard/types"

function toRows(accounts: SalesAccountSummary[]): TableCell[][] {
  return accounts.map((a) => [
    {
      node: (
        <div className="min-w-0">
          <div className="truncate font-semibold">{a.name}</div>
          {a.assigneeCount > 0 ? (
            <div className="truncate text-[11.5px] text-[#6B7789]">
              {a.assigneeCount} {a.assigneeCount === 1 ? "collaborator" : "collaborators"}
            </div>
          ) : null}
        </div>
      ),
    },
    { text: a.ownerName },
    { tag: ACCOUNT_STATUS_LABEL[a.status], tone: ACCOUNT_STATUS_TONE[a.status] },
    {
      node: <RowActions actions={[{ kind: "link", label: "Open", href: `/sales/accounts/${a.id}` }]} />,
    },
  ])
}

export function AccountsPage() {
  const { accessToken, user, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()

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

  const accountsQuery = useQuery({
    queryKey: ["sales", "accounts"],
    queryFn: () => listSalesAccounts(accessToken!),
    enabled: isAuthed,
  })

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(accessToken!),
    enabled: isAuthed && createOpen,
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
  const rows = useMemo(() => toRows(accounts), [accounts])
  const employees = employeesQuery.data ?? []
  const isLoading = sessionStatus === "loading" || accountsQuery.isPending

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Sales Accounts"
        sub="Every company the team sells to, with an owner answerable for each one."
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
        emptyTitle="No Sales Accounts yet"
        emptyBody={
          canCreate
            ? "Create the first one. Once an account exists, anyone assigned to it can record calls, meetings and deals against it."
            : "A Sales Admin creates the first one. Once an account exists, anyone assigned to it can record calls, meetings and deals against it."
        }
        emptyAction={canCreate ? "New Sales Account" : "Ask a Sales Admin"}
        onEmptyAction={canCreate ? handleOpenCreate : () => {}}
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

              <Field label="Owner" hint="Answerable for this account. Reminders go to them.">
                <Select value={ownerEmployeeId} onValueChange={(v) => setOwnerEmployeeId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string | null) =>
                        employees.find((e) => e.id === v)?.work.fullName ?? "Select an owner"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.work.fullName} — {e.work.designation}
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
                          label={e.work.fullName}
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
