"use client"

import { useState } from "react"

import { ApiError } from "@/lib/api/client"
import type { ResendInviteResult } from "@/lib/api/types"
import { PanelAlert } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/**
 * Send a person a new temporary password: ask first, send, then show it once.
 *
 * One component for both the Users page and the employee page, which differ
 * only in which endpoint `send` calls. The server decides whether it is
 * allowed and says why when it is not, so its sentence is shown as it is.
 *
 * The password is shown because the email may not arrive. That is the whole
 * reason the person is stuck, so an admin must be able to pass it on.
 */
export function ResendPasswordDialog({
  open,
  who,
  send,
  onClose,
  onSent,
}: {
  open: boolean
  /** Who it is for: a name or an email address. */
  who: string
  send: () => Promise<ResendInviteResult>
  onClose: () => void
  /** Called once the new password is made, so the page can refresh its data. */
  onSent?: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResendInviteResult | null>(null)
  const [copied, setCopied] = useState(false)

  function close() {
    if (pending) return
    setError(null)
    setResult(null)
    setCopied(false)
    onClose()
  }

  async function handleSend() {
    setPending(true)
    setError(null)
    try {
      setResult(await send())
      onSent?.()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    } finally {
      setPending(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Clipboard can be blocked. The password is on screen, so nothing is lost.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>New password sent</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-[13.5px]">
              <p>
                We sent a new temporary password to <strong>{result.email}</strong>. The old one no
                longer works.
              </p>
              <div className="rounded-md border border-[#E4E9EF] bg-[#F4F6F9] p-3 font-mono text-[13px]">
                {result.temporaryPassword}
              </div>
              <p className="text-[#5F6B7C]">
                This is shown only once. If the email does not arrive, give them this password
                yourself. They must choose their own password when they sign in.
              </p>
              <Button type="button" variant="outline" onClick={() => copy(result.temporaryPassword)}>
                {copied ? "Copied" : "Copy password"}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={close} className="bg-[#17191C] text-white hover:bg-[#0E1012]">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Send a new password?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-[13.5px]">
              <p>
                We will make a new temporary password for <strong>{who}</strong> and email it to
                them.
              </p>
              <p className="text-[#5F6B7C]">
                The old password will stop working. If they are signed in now, they will be signed
                out.
              </p>
              {error ? <PanelAlert>{error}</PanelAlert> : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={handleSend}
                disabled={pending}
                className="bg-[#17191C] text-white hover:bg-[#0E1012]"
              >
                {pending ? "Sending…" : "Send new password"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
