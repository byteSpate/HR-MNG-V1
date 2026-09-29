"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { handOverToSoftware, listHandOverOwners } from "@/lib/api/sales/opportunities"
import { opportunityWriteKeys, salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunitySummary } from "@/lib/api/types"
import { DialogActions, Field, FormError, toMessage } from "@/components/dashboard/record-kit"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

const SELECT = "h-9 w-full rounded-md border bg-transparent px-3 text-sm"

/**
 * Hand the software part of a Networking Opportunity to the Software team
 * (CONTEXT.md, Hand-over; spec §2.5).
 *
 * It makes a second, linked Opportunity rather than moving this one, because
 * the Networking team keeps the equipment and its own history. It can be done
 * once and cannot be undone, so the dialog says so before the button.
 */
export function HandOverDialog({
  deal,
  open,
  onOpenChange,
}: {
  deal: OpportunitySummary
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { accessToken } = useSession()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [name, setName] = useState(`${deal.name} (Software)`)
  const [ownerId, setOwnerId] = useState("")
  const [error, setError] = useState<string | null>(null)

  // Loaded only while the dialog is open: the Software team on an account
  // changes rarely, and the list is a means to an end, not a page of its own.
  const owners = useQuery({
    queryKey: salesKeys.handOverOwners(deal.id),
    queryFn: () => listHandOverOwners(accessToken!, deal.id),
    enabled: open && !!accessToken,
  })

  const save = useMutation({
    mutationFn: () => handOverToSoftware(accessToken!, deal.id, { name, ownerEmployeeId: ownerId }),
    onSuccess: async (created) => {
      setError(null)
      await queryClient.invalidateQueries({ queryKey: opportunityWriteKeys(deal.id) })
      onOpenChange(false)
      router.push(`/sales/opportunities/${created.id}`)
    },
    onError: (err) => setError(toMessage(err)),
  })

  const list = owners.data ?? []
  const none = !owners.isPending && !owners.isError && list.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hand software to the Software team</DialogTitle>
          <DialogDescription>
            This makes a new Software Development Opportunity on the same account, linked to this
            one. You can do this once, and it cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error ? <FormError>{error}</FormError> : null}

        <Field
          label="Name"
          htmlFor="handover-name"
          help="The name of the new Software Opportunity."
        >
          <Input id="handover-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field
          label="Owner"
          htmlFor="handover-owner"
          help="A Software Development person already on this account. They own the new Opportunity."
        >
          {owners.isPending ? (
            <Skeleton className="h-9 w-full" />
          ) : owners.isError ? (
            // Broken is not the same as empty: an empty list means nobody fits,
            // a failed one means we do not know yet.
            <p role="alert" className="text-[12.5px] font-semibold text-[#B03A3A]">
              The list of people could not be loaded.{" "}
              <button type="button" className="underline" onClick={() => owners.refetch()}>
                Try again
              </button>
            </p>
          ) : (
            <select
              id="handover-owner"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className={SELECT}
              disabled={none}
            >
              <option value="">Pick someone</option>
              {list.map((person) => (
                <option key={person.id} value={person.id}>{person.fullName}</option>
              ))}
            </select>
          )}
        </Field>

        {none ? (
          <p className="text-[12.5px]">
            Nobody on this account is in the Software Development department. A Sales Admin must
            first add a Software person to the account.
          </p>
        ) : null}

        <DialogActions
          submitLabel="Hand over"
          onCancel={() => onOpenChange(false)}
          onSubmit={() => save.mutate()}
          pending={save.isPending}
          disabled={none || owners.isPending || owners.isError || !ownerId || name.trim().length < 2}
        />
      </DialogContent>
    </Dialog>
  )
}
