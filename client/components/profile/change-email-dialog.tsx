"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiMailLine, RiTimeLine } from "@remixicon/react"

import { ApiError } from "@/lib/api/client"
import { getPendingEmailChange, requestEmailChange } from "@/lib/api/auth"
import { useSession } from "@/lib/auth/session-context"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * Starting a change of sign-in address.
 *
 * The dialog's job is mostly to set expectations, because the flow is longer
 * than people expect and the surprising part comes *after* they submit:
 * nothing changes yet, and the first email lands in the address they are
 * moving away from, not the one they just typed. A form that said "saved"
 * would be lying, so this one says what will actually happen before they
 * commit and again after.
 *
 * Why two emails is explained in `auth.emailchange.ts`. The short version for
 * a reader here: the old address proves it was really you, the new address
 * proves it exists.
 */
export function ChangeEmailDialog({
  open,
  onOpenChange,
  currentEmail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentEmail: string
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [newEmail, setNewEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => requestEmailChange(accessToken!, newEmail.trim()),
    onSuccess: () => {
      setError(null)
      // Not "saved" — nothing has changed. What happened is that an email is
      // now sitting in the *old* inbox, and that is the surprising part.
      setSentTo(currentEmail)
      queryClient.invalidateQueries({ queryKey: ["email-change"] })
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  const looksLikeEmail = /^\S+@\S+\.\S+$/.test(newEmail.trim())
  const sameAsNow = newEmail.trim().toLowerCase() === currentEmail.toLowerCase()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sentTo ? "Check your current inbox" : "Change your email"}</DialogTitle>
        </DialogHeader>

        {sentTo ? (
          <div className="space-y-4 text-[13px] leading-relaxed">
            <p>
              We sent an approval link to <strong>{sentTo}</strong> — the address you are moving
              away from, not the new one.
            </p>
            <p className="text-[#5F6B7C]">
              Open it and confirm the change was you. Only then do we email{" "}
              <strong>{newEmail.trim()}</strong> to check that inbox works. Your address changes
              after both steps, and nothing changes if you stop here.
            </p>
            <p className="rounded-md border border-[#E4E9EF] bg-[#F8FAFC] px-3.5 py-2.5 text-[12.5px] text-[#5F6B7C]">
              The link lasts one hour. If it expires, start again.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 text-xs font-bold">Current address</Label>
              <div className="rounded-md border border-[#E4E9EF] bg-[#F8FAFC] px-3 py-2 text-[13px] text-[#5F6B7C]">
                {currentEmail}
              </div>
            </div>

            <div>
              <Label htmlFor="new-email" className="mb-1.5 text-xs font-bold">
                New address
              </Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="email"
                value={newEmail}
                placeholder="you@example.com"
                onChange={(e) => setNewEmail(e.target.value)}
              />
              {sameAsNow && newEmail.trim() ? (
                <p className="mt-1.5 text-[11.5px] font-medium text-[#B03A3A]">
                  That is already your address.
                </p>
              ) : null}
            </div>

            {/* Said before they commit, not after. Two inboxes is not what
                anyone expects from a form with one field in it. */}
            <div className="rounded-md border border-[#E4E9EF] bg-[#F8FAFC] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#5F6B7C]">
              <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#17191C]">
                <RiMailLine className="size-3.5" aria-hidden />
                This takes two steps
              </div>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  We email <strong>{currentEmail}</strong> to check the change is really you.
                </li>
                <li>Then we email the new address to check it works.</li>
              </ol>
              <p className="mt-2">
                You will be signed out everywhere once it is done.
              </p>
            </div>

            {error ? <p className="text-[12.5px] text-[#B03A3A]">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          {sentTo ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!looksLikeEmail || sameAsNow || mutation.isPending}
                onClick={() => mutation.mutate()}
              >
                {mutation.isPending ? "Sending…" : "Send approval email"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The banner on the profile while a change is in flight.
 *
 * Worth its own component because "you asked to move to X, and it is waiting
 * on you" is otherwise invisible — the address on screen is still the old one,
 * so nothing on the page would suggest anything is happening at all.
 */
export function PendingEmailChangeNotice() {
  const { accessToken } = useSession()
  const { data } = useQuery({
    queryKey: ["email-change"],
    queryFn: () => getPendingEmailChange(accessToken!),
    enabled: !!accessToken,
  })

  if (!data) return null

  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-md border border-[#E4CFA6] bg-[#FDF8EE] px-4 py-3 text-[12.5px] leading-relaxed text-[#8A5E0C]">
      <RiTimeLine className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        <div className="font-semibold">
          Waiting to move this account to {data.newEmail}
        </div>
        <p className="mt-0.5">
          {data.approved
            ? "Approved. Now open the email we sent to the new address to finish."
            : "Open the email we sent to your current address and approve it."}{" "}
          Nothing has changed yet.
        </p>
      </div>
    </div>
  )
}

/**
 * The sign-in address, with a way to change it. Self-contained so the staff
 * profile can drop it in beside the sessions card.
 *
 * It lives next to "where you're signed in" rather than among the contact
 * details on purpose: this address is not how the company reaches you, it is
 * how you get in, and it is where a password reset would be sent. Grouping it
 * with a phone number invites people to treat it as one.
 */
export function SignInEmailCard({ email }: { email: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[13px] font-bold">
              <RiMailLine className="size-4 text-[#5F6B7C]" aria-hidden />
              How you sign in
            </div>
            <div className="mt-1.5 text-[13px] break-words text-[#17191C]">{email}</div>
            <p className="mt-1 text-[12px] text-[#5F6B7C]">
              This is your username, and where a password reset would be sent.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            Change email
          </Button>
        </div>
      </div>

      {/* Mounted only while open, so a second attempt starts from a blank form. */}
      {open ? (
        <ChangeEmailDialog open={open} onOpenChange={setOpen} currentEmail={email} />
      ) : null}
    </>
  )
}
