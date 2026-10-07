"use client"

/**
 * A Sales Account's collaborators, inside the Edit Sales Account dialog (owner,
 * 2026-10-07; it used to be its own panel on the About tab). The Owner adds one
 * directly and can ask for one to be removed, which waits for a Sales Admin. A
 * Sales Admin removes at once. Buttons that the server would refuse are hidden;
 * the server is the real gate. Each change saves at once, apart from the
 * dialog's own Save changes button, and the section says so.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  addCollaborator,
  cancelRemovalRequest,
  listCollaboratorOptions,
  listRemovalRequests,
  removeCollaborator,
  requestRemoval,
} from "@/lib/api/sales/removals"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { SalesAccountSummary, SalesRemovalRequest } from "@/lib/api/types"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { useSalesPermissions } from "@/components/sales/shared/use-sales-permissions"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const SMALL = "h-auto rounded-md px-2.5 py-1 text-[12px] font-bold"

/** The newest request for each collaborator. The list is newest first. */
function latestByPerson(rows: SalesRemovalRequest[]): Map<string, SalesRemovalRequest> {
  const latest = new Map<string, SalesRemovalRequest>()
  for (const row of rows) if (!latest.has(row.employeeId)) latest.set(row.employeeId, row)
  return latest
}

export function CollaboratorsSection({ account }: { account: SalesAccountSummary }) {
  const { accessToken, user, status } = useSession()
  const queryClient = useQueryClient()
  const { can } = useSalesPermissions()
  const isAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")
  // `canChangeOwner` is true for the Owner and for a Sales Admin.
  const isOwner = account.canChangeOwner && !isAdmin
  const mayWrite = isAdmin || (isOwner && can("account.edit"))
  const isAuthed = status === "authenticated" && !!accessToken

  const [pick, setPick] = useState("")
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requestsQuery = useQuery({
    queryKey: salesKeys.removals(account.id),
    queryFn: () => listRemovalRequests(accessToken!, { accountId: account.id }),
    enabled: isAuthed && (isOwner || isAdmin),
  })
  const optionsQuery = useQuery({
    queryKey: salesKeys.collaboratorOptions(account.id),
    queryFn: () => listCollaboratorOptions(accessToken!, account.id),
    enabled: isAuthed && mayWrite,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: salesKeys.account(account.id) })
    // The shared prefix, so both this Sales Account's list and the admin's
    // list refresh. `salesKeys.removals()` alone is a sibling, not a parent.
    void queryClient.invalidateQueries({ queryKey: ["sales", "removals"] })
    void queryClient.invalidateQueries({ queryKey: salesKeys.collaboratorOptions(account.id) })
    void queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] })
  }
  const onError = (err: unknown) => setError(toMessage(err))

  const add = useMutation({
    mutationFn: (employeeId: string) => addCollaborator(accessToken!, account.id, employeeId),
    onSuccess: () => { setError(null); setPick(""); refresh() },
    onError,
  })
  const removeNow = useMutation({
    mutationFn: (employeeId: string) => removeCollaborator(accessToken!, account.id, employeeId),
    onSuccess: () => { setError(null); setConfirming(null); refresh() },
    onError,
  })
  const ask = useMutation({
    mutationFn: (employeeId: string) => requestRemoval(accessToken!, account.id, employeeId),
    onSuccess: () => { setError(null); setConfirming(null); refresh() },
    onError,
  })
  const cancel = useMutation({
    mutationFn: (id: string) => cancelRemovalRequest(accessToken!, id),
    onSuccess: () => { setError(null); refresh() },
    onError,
  })

  const latest = latestByPerson(requestsQuery.data?.items ?? [])
  const options = optionsQuery.data ?? []

  return (
    <section className={`space-y-3 border-t pt-4 ${TONE.line}`} aria-labelledby="collaborators-heading">
      <div>
        <h3 id="collaborators-heading" className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>
          Collaborators
        </h3>
        <p className={`mt-1 text-[12px] leading-relaxed ${TONE.muted}`}>
          Each change here is saved at once. You do not need to press Save changes.
        </p>
      </div>
      {error ? <PanelAlert>{error}</PanelAlert> : null}

      {account.assignees.length === 0 ? (
        <p className={`text-[13px] ${TONE.muted}`}>This Sales Account has no collaborators yet.</p>
      ) : (
        <ul className="grid gap-2" data-testid="collaborator-list">
          {account.assignees.map((person) => {
            const request = latest.get(person.id)
            const waiting = request?.status === "PENDING" ? request : null
            const refused = request?.status === "REFUSED" ? request : null
            return (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                <div className="min-w-0">
                  <span className="font-semibold">{person.fullName}</span>
                  {waiting ? <span className={`ml-2 text-[12px] ${TONE.muted}`}>Waiting for a Sales Admin</span> : null}
                  {refused?.refusalReason ? (
                    <div className={`text-[12px] ${TONE.muted}`}>A Sales Admin said no: {refused.refusalReason}</div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {waiting && isOwner && mayWrite ? (
                    <Button type="button" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(waiting.id)} className={SMALL}>
                      Cancel the request
                    </Button>
                  ) : null}
                  {!waiting && mayWrite && confirming !== person.id ? (
                    <Button type="button" variant="ghost" onClick={() => setConfirming(person.id)} className={SMALL}>
                      {isAdmin ? "Remove" : "Ask to remove"}
                    </Button>
                  ) : null}
                  {confirming === person.id ? (
                    <>
                      <span className={`text-[12px] ${TONE.muted}`}>
                        {isAdmin ? `Remove ${person.fullName} now?` : `Ask a Sales Admin to remove ${person.fullName}?`}
                      </span>
                      <Button
                        type="button"
                        disabled={removeNow.isPending || ask.isPending}
                        onClick={() => (isAdmin ? removeNow.mutate(person.id) : ask.mutate(person.id))}
                        className={`${SMALL} bg-[#17191C] text-white hover:bg-[#0E1012]`}
                      >
                        {isAdmin ? "Remove" : "Send the request"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setConfirming(null)} className={SMALL}>
                        Keep
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {mayWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={pick} onValueChange={(value) => setPick(value ?? "")}>
            <SelectTrigger className="w-64" aria-label="Add a collaborator">
              <SelectValue>
                {(value: string | null) => options.find((o) => o.id === value)?.fullName ?? "Choose a person to add"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.fullName}
                  {" - "}
                  {o.designation}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            disabled={!pick || add.isPending}
            onClick={() => add.mutate(pick)}
            className="h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
          >
            Add collaborator
          </Button>
          {optionsQuery.isSuccess && options.length === 0 ? (
            <span className={`text-[12px] ${TONE.muted}`}>Nobody else can be added right now.</span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
