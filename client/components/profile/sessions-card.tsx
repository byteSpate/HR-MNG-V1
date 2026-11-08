"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiCheckboxCircleFill,
  RiComputerLine,
  RiDeviceLine,
  RiSmartphoneLine,
} from "@remixicon/react"

import { listSessions, revokeSession } from "@/lib/api/auth"
import { useSession } from "@/lib/auth/session-context"
import type { SessionView } from "@/lib/api/types"
import { ConfirmDialog, PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { Heading } from "@/components/ds/heading"

/**
 * Where this account is signed in, for every role.
 *
 * Rendered on both branches of My Profile — staff and administrative alike —
 * because "is anybody else in my account" is not a question that belongs to
 * one kind of user.
 *
 * The list is only possible because `RefreshToken` now carries a `sessionId`
 * that survives rotation. Before that migration, refreshing replaced the row
 * every fifteen minutes, so one phone appeared as a new device four times an
 * hour and there was nothing durable to sign out.
 */

/** Rough, and only rough: this decides a glyph, not a fact on screen. */
function deviceIcon(device: string) {
  if (/iOS|Android/.test(device)) return RiSmartphoneLine
  if (/Windows|macOS|Linux|ChromeOS/.test(device)) return RiComputerLine
  return RiDeviceLine
}

function since(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 2) return "active now"
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short" })
}

function started(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
}

export function SessionsCard() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [ending, setEnding] = useState<SessionView | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sessions = useQuery({
    queryKey: ["my-sessions"],
    queryFn: () => listSessions(accessToken!),
    enabled: !!accessToken,
  })

  const endSession = useMutation({
    mutationFn: (sessionId: string) => revokeSession(accessToken!, sessionId),
    onSuccess: () => {
      setError(null)
      setEnding(null)
      queryClient.invalidateQueries({ queryKey: ["my-sessions"] })
      // The count on the security card is the same fact from another query.
      queryClient.invalidateQueries({ queryKey: ["my-profile"] })
    },
    // Verbatim, as everywhere else: the server's refusal for revoking your own
    // session names what to do instead.
    onError: (err) => setError(toMessage(err)),
  })

  const rows = sessions.data ?? []

  return (
    <section className="rounded-md border border-[#E4E9EF] bg-white px-5 py-4.5">
      <header className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading level="section" className="flex items-center gap-2">
          <RiDeviceLine className="size-4 text-[#8A94A2]" aria-hidden />
          Where you&apos;re signed in
        </Heading>
        {rows.length > 0 ? (
          <span className={cn("text-[12.5px] tabular-nums", TONE.muted)}>
            {rows.length} {rows.length === 1 ? "device" : "devices"}
          </span>
        ) : null}
      </header>
      <p className={cn("mb-3.5 text-[12.5px] leading-relaxed", TONE.muted)}>
        If you don&apos;t recognise something here, end it and change your password.
      </p>

      {error ? (
        <div className="mb-3">
          <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert>
        </div>
      ) : null}

      {sessions.isPending ? (
        <div className="space-y-2.5">
          {[0, 1].map((row) => (
            <div key={row} className="space-y-2 rounded-md border border-[#EEF1F5] p-3">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : sessions.isError ? (
        <div className="rounded-md border border-[#EEF1F5] px-3.5 py-3">
          <p className={cn("text-[12.5px]", TONE.muted)}>
            This list could not be loaded. Nothing has changed.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2.5"
            onClick={() => sessions.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        // Reachable: a bearer-token client, or every session just revoked.
        // Not an error, and not worth a full empty-state illustration.
        <p className={cn("text-[12.5px]", TONE.muted)}>No other sign-ins are active.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const Icon = deviceIcon(row.device)
            return (
              <li
                key={row.sessionId}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3.5 py-3",
                  row.current ? "border-[#CFE3D6] bg-[#F7FBF8]" : "border-[#EEF1F5]"
                )}
              >
                <Icon
                  className={cn("size-4.5 shrink-0", row.current ? "text-[#1E7A3C]" : "text-[#8A94A2]")}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold">
                    {row.device}
                    {row.current ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#E3F3E8] px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-[#1E7A3C] uppercase">
                        <RiCheckboxCircleFill className="size-3" aria-hidden />
                        This device
                      </span>
                    ) : null}
                  </div>
                  <div className={cn("mt-0.5 text-[12px]", TONE.muted)}>
                    {/* The IP is shown because an unfamiliar one is the whole
                        signal. Absent rather than "unknown" when nothing was
                        recorded — a session predating this feature. */}
                    {row.ipAddress ? `${row.ipAddress} · ` : ""}
                    {since(row.lastUsedAt)} · signed in {started(row.startedAt)}
                  </div>
                </div>
                {row.current ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={endSession.isPending}
                    onClick={() => {
                      setError(null)
                      setEnding(row)
                    }}
                  >
                    End session
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!ending}
        title="End this session?"
        body={
          <>
            <strong>{ending?.device}</strong> will be signed out immediately and will need to sign
            in again. Your password does not change.
          </>
        }
        confirmLabel="End session"
        pending={endSession.isPending}
        onCancel={() => setEnding(null)}
        onConfirm={() => ending && endSession.mutate(ending.sessionId)}
      />
    </section>
  )
}
