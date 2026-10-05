"use client"

/**
 * "Removal requests": what Owners have asked a Sales Admin to decide. Sales
 * Admins only. Approve takes the collaborator off the Sales Account. Refuse
 * needs a short reason, which the Owner sees. Not called "Waiting for approval":
 * that is already the Super Admin's list of invoices and bills.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { approveRemovalRequest, listRemovalRequests, refuseRemovalRequest } from "@/lib/api/sales/removals"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

export function RemovalRequestsPanel() {
  const { accessToken, user, status } = useSession()
  const queryClient = useQueryClient()
  const isAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")
  const [refusing, setRefusing] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: salesKeys.removals(),
    queryFn: () => listRemovalRequests(accessToken!, { status: "PENDING" }),
    enabled: status === "authenticated" && !!accessToken && isAdmin,
  })

  const done = () => {
    setError(null)
    setRefusing(null)
    setReason("")
    void queryClient.invalidateQueries({ queryKey: ["sales", "removals"] })
    void queryClient.invalidateQueries({ queryKey: ["sales", "accounts"] })
    void queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] })
  }
  const approve = useMutation({
    mutationFn: (id: string) => approveRemovalRequest(accessToken!, id),
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })
  const refuse = useMutation({
    mutationFn: (id: string) => refuseRemovalRequest(accessToken!, id, reason.trim()),
    onSuccess: done,
    onError: (err) => setError(toMessage(err)),
  })

  if (!isAdmin) return null

  return (
    <section className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5" data-testid="removal-requests">
      <h2 className="text-[14px] font-bold">Removal requests</h2>
      <p className={`mt-1 text-[12.5px] ${TONE.muted}`}>
        An Owner asked to take a collaborator off a Sales Account. The collaborator keeps their access until you
        approve. Only Sales Admins can decide.
      </p>

      {error ? <div className="mt-3"><PanelAlert>{error}</PanelAlert></div> : null}

      <div className="mt-4">
        {query.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : query.isError ? (
          <PanelAlert>{toMessage(query.error)}</PanelAlert>
        ) : query.data.items.length === 0 ? (
          <p className={`text-[13px] ${TONE.muted}`}>Nothing is waiting.</p>
        ) : (
          <ul className="grid gap-3">
            {query.data.items.map((row) => (
              <li key={row.id} className="grid gap-2 border-b border-[#EEF1F5] pb-3 last:border-0 last:pb-0">
                <div className="text-[13px]">
                  <span className="font-semibold">{row.requestedByName ?? "An Owner"}</span> asked to remove{" "}
                  <span className="font-semibold">{row.employeeName}</span> from{" "}
                  <span className="font-semibold">{row.accountName}</span>.
                </div>
                {refusing === row.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Say why. A short reason is enough."
                      className="w-80"
                      aria-label="Reason for refusing"
                    />
                    <Button
                      type="button"
                      disabled={reason.trim().length < 3 || refuse.isPending}
                      onClick={() => refuse.mutate(row.id)}
                      className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
                    >
                      Send the refusal
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setRefusing(null)} className="h-auto px-2.5 py-1.5 text-[12px] font-bold">
                      Back
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={approve.isPending}
                      onClick={() => approve.mutate(row.id)}
                      className="h-auto rounded-md bg-[#17191C] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#0E1012]"
                    >
                      Approve
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => { setRefusing(row.id); setReason("") }} className="h-auto px-2.5 py-1.5 text-[12px] font-bold">
                      Refuse
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
