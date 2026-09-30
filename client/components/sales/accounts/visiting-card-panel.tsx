"use client"

import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  RiDeleteBinLine,
  RiFullscreenLine,
  RiIdCardLine,
  RiImageLine,
  RiRefreshLine,
  RiUploadLine,
} from "@remixicon/react"

import { removeVisitingCard, setVisitingCard } from "@/lib/api/sales/accounts"
import { useSession } from "@/lib/auth/session-context"
import { CARD_ACCEPT, checkCardFile } from "@/lib/visiting-card"
import type { SalesAccountSummary } from "@/lib/api/types"
import { AvatarLightbox } from "@/components/dashboard/avatar-lightbox"
import { ConfirmDialog, PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { CardDropZone } from "@/components/sales/accounts/visiting-card-picker"
import { Panel } from "@/components/sales/shared/panel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * The card picture in its frame.
 *
 * The frame keeps a minimum height until the picture has loaded, so the panel
 * does not jump, and a skeleton fills it meanwhile. The picture then fades in
 * over 200ms. Cards come in every shape, so the picture is never cropped: it is
 * shown whole (`object-contain`) inside a quiet grey mat, at most 16rem tall.
 * If it cannot be loaded the frame says so and offers another try, because a
 * broken image icon says nothing.
 */
function CardImage({
  url,
  name,
  uploading,
}: {
  url: string
  name: string
  uploading: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-[#E4E9EF] bg-[#F7F9FB] p-2",
        !loaded && !failed && "min-h-44",
      )}
    >
      {!loaded && !failed ? <Skeleton className="absolute inset-2 rounded-md" /> : null}
      {failed ? (
        <div className="flex min-h-44 flex-col items-center justify-center gap-2 text-center">
          <span className="flex size-8 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiImageLine className="size-4" aria-hidden />
          </span>
          <div className="text-[12.5px] font-semibold text-[#5F6B7C]">The picture could not be loaded.</div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFailed(false)
              setAttempt((n) => n + 1)
            }}
            className="h-8 gap-1.5 px-2.5 text-[12px] font-bold"
          >
            <RiRefreshLine className="size-3.5" aria-hidden />
            Try again
          </Button>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={attempt}
          src={url}
          alt={`Visiting card of ${name}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "mx-auto block h-auto max-h-64 w-auto max-w-full rounded-sm object-contain transition-opacity duration-200 ease-out motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
            uploading && "opacity-50",
          )}
        />
      )}
      {uploading ? (
        <div className="absolute inset-x-0 bottom-2 text-center text-[12px] font-semibold text-[#33373D]" role="status">
          Uploading…
        </div>
      ) : null}
    </div>
  )
}

/**
 * The "Visiting card" panel on an account's Contacts tab. The card holds the
 * contact details of the person the team met, so it sits with the contacts. It
 * belongs to the account and is not tied to any one contact person.
 *
 * Everyone who can open the account sees the card. The people who can edit the
 * account (its owner, its collaborators and a Sales Admin, the same rule as the
 * server) can also add, replace and remove it. With no card, an editor sees the
 * drop area and can add one on the spot, and everybody else sees a plain
 * sentence, so nobody is shown a control that cannot work for them.
 */
export function VisitingCardPanel({ account }: { account: SalesAccountSummary }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [zoom, setZoom] = useState(false)

  const url = account.visitingCardUrl
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sales", "accounts"] })

  const upload = useMutation({
    mutationFn: (file: File) => setVisitingCard(accessToken!, account.id, file),
    onSuccess: async () => {
      setError(null)
      await refresh()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const remove = useMutation({
    mutationFn: () => removeVisitingCard(accessToken!, account.id),
    onSuccess: async () => {
      setConfirmRemove(false)
      setError(null)
      await refresh()
    },
    onError: (err) => {
      setConfirmRemove(false)
      setError(toMessage(err))
    },
  })

  return (
    <Panel>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-[#F1F4F8] text-[#33373D]">
          <RiIdCardLine className="size-3.5" aria-hidden />
        </span>
        <div className="text-[13.5px] font-bold">Visiting card</div>
      </div>

      {error ? (
        <div className="mb-3">
          <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert>
        </div>
      ) : null}

      {url ? (
        <>
          {/* Keyed by the address: a replaced card is a new picture, so it gets a
              fresh skeleton and fade instead of flashing the old one. */}
          <CardImage key={url} url={url} name={account.name} uploading={upload.isPending} />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setZoom(true)}
              className="h-8 gap-1.5 px-2.5 text-[12px] font-bold"
            >
              <RiFullscreenLine className="size-3.5" aria-hidden />
              View full size
            </Button>
            {account.canManage ? (
              <span className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={upload.isPending}
                  onClick={() => inputRef.current?.click()}
                  className="h-8 gap-1.5 px-2.5 text-[12px] font-bold"
                >
                  <RiUploadLine className="size-3.5" aria-hidden />
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="link"
                  disabled={upload.isPending}
                  onClick={() => setConfirmRemove(true)}
                  className="h-8 gap-1.5 px-2 text-[12px] font-bold text-[#B03A3A] underline"
                >
                  <RiDeleteBinLine className="size-3.5" aria-hidden />
                  Remove
                </Button>
              </span>
            ) : null}
          </div>
        </>
      ) : account.canManage ? (
        upload.isPending ? (
          <div className="space-y-2" role="status">
            <Skeleton className="h-[74px] w-full" />
            <div className={cn("text-[12px] font-semibold", TONE.muted)}>Uploading…</div>
          </div>
        ) : (
          <CardDropZone
            onFile={(file) => upload.mutate(file)}
            onProblem={setError}
            title="Add a visiting card"
            hint="Click to choose a picture, or drop it here. JPG, PNG or WebP, up to 5 MB."
          />
        )
      ) : (
        <div className="flex items-center gap-3 rounded-md border border-dashed border-[#E4E9EF] px-4 py-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#F1F4F8] text-[#5F6B7C]">
            <RiIdCardLine className="size-5" aria-hidden />
          </span>
          <div className={cn("text-[12.5px]", TONE.muted)}>No visiting card has been added for this account.</div>
        </div>
      )}

      {/* One hidden input serves Replace. Kept out of the tab order: the
          visible Replace button is the control. */}
      <input
        ref={inputRef}
        type="file"
        accept={CARD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a new visiting card picture"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ""
          if (!picked) return
          const problem = checkCardFile(picked)
          setError(problem)
          if (!problem) upload.mutate(picked)
        }}
      />

      <ConfirmDialog
        open={confirmRemove}
        title="Remove this visiting card?"
        body="The picture is deleted. You can add another one later."
        confirmLabel="Remove card"
        pending={remove.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => remove.mutate()}
      />

      {url ? (
        <AvatarLightbox src={url} alt={`Visiting card of ${account.name}`} open={zoom} onOpenChange={setZoom} />
      ) : null}
    </Panel>
  )
}
