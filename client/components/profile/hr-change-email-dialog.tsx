"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { RiAlertLine } from "@remixicon/react"

import { ApiError } from "@/lib/api/client"
import { changeEmployeeEmail } from "@/lib/api/employees"
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
 * HR correcting the address on somebody else's account.
 *
 * The opposite of the self-service dialog, and the copy has to say so. That
 * one promises "nothing changes yet"; this one takes effect the moment it is
 * saved, because it exists for people who cannot approve anything — the invite
 * went to the wrong address and they never received it.
 *
 * So the dialog leads with the consequences rather than burying them: it
 * happens now, they get signed out, and both addresses are told. Confirming
 * without knowing that is how somebody locks a colleague out by fixing a
 * "typo" that was not one.
 */
export function HrChangeEmailDialog({
  open,
  onOpenChange,
  employeeId,
  employeeName,
  currentEmail,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  employeeId: string
  employeeName: string
  currentEmail: string
  onChanged: () => void
}) {
  const { accessToken } = useSession()
  const [newEmail, setNewEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ email: string; inviteResent: boolean } | null>(null)

  const mutation = useMutation({
    mutationFn: () => changeEmployeeEmail(accessToken!, employeeId, newEmail.trim()),
    onSuccess: (r) => {
      setError(null)
      setDone({ email: r.email, inviteResent: r.inviteResent })
      onChanged()
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  const looksLikeEmail = /^\S+@\S+\.\S+$/.test(newEmail.trim())
  const sameAsNow = newEmail.trim().toLowerCase() === currentEmail.toLowerCase()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{done ? "Address changed" : `Change ${employeeName}'s email`}</DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 text-[13px] leading-relaxed">
            <p>
              This account now signs in with <strong>{done.email}</strong>.
            </p>
            <p className="text-[#5F6B7C]">
              {done.inviteResent
                ? // The reason HR is usually here. Worth saying plainly, because
                  // a fresh temporary password went out and the old one is dead.
                  "They had never signed in, so a fresh invite went to the new address with a new temporary password. The old one no longer works."
                : "They were signed out everywhere and will need to sign in again with the new address. Their password is unchanged."}
            </p>
            <p className="text-[#5F6B7C]">Both the old and the new address were notified.</p>
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
              <Label htmlFor="hr-new-email" className="mb-1.5 text-xs font-bold">
                New address
              </Label>
              <Input
                id="hr-new-email"
                type="email"
                value={newEmail}
                placeholder="name@example.com"
                onChange={(e) => setNewEmail(e.target.value)}
              />
              {sameAsNow && newEmail.trim() ? (
                <p className="mt-1.5 text-[11.5px] font-medium text-[#B03A3A]">
                  That is already the address on this account.
                </p>
              ) : null}
            </div>

            <div className="flex items-start gap-2.5 rounded-md border border-[#E4CFA6] bg-[#FDF8EE] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#8A5E0C]">
              <RiAlertLine className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <div className="font-semibold">This happens straight away</div>
                <p className="mt-0.5">
                  Unlike changing your own, there is no approval step — that is the point, since
                  they may not be able to reach the old inbox. They will be signed out everywhere,
                  both addresses will be told, and the change is recorded against your name.
                </p>
              </div>
            </div>

            {error ? <p className="text-[12.5px] text-[#B03A3A]">{error}</p> : null}
          </div>
        )}

        <DialogFooter>
          {done ? (
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
                {mutation.isPending ? "Changing…" : "Change it now"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
