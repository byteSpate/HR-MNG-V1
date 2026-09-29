"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiExternalLinkLine } from "@remixicon/react"

import { addDocumentLink, listDocumentLinks, removeDocumentLink } from "@/lib/api/sales/opportunities"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunitySummary } from "@/lib/api/types"
import { ConfirmDeleteDialog, Field, PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { STAGE_LABEL } from "@/components/sales/shared/sales-shared"
import { Panel, PanelHeading } from "@/components/sales/shared/panel"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Links to files kept outside the app, each with the Stage it belongs to
 * (spec 2026-09-28 §1.5). Optional. Every version stays in the list.
 */
export function DocumentsPanel({ deal, canManage }: { deal: OpportunitySummary; canManage: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  // Says why "Add link" is off, instead of leaving a dead button.
  const badAddress = url.trim() !== "" && !url.trim().startsWith("https://")
  const key = salesKeys.opportunityDocuments(deal.id)
  const query = useQuery({ queryKey: key, queryFn: () => listDocumentLinks(accessToken!, deal.id), enabled: !!accessToken })

  const add = useMutation({
    mutationFn: () => addDocumentLink(accessToken!, deal.id, { name: name.trim(), url: url.trim() }),
    onSuccess: () => { setName(""); setUrl(""); setError(null); queryClient.invalidateQueries({ queryKey: key }) },
    onError: (err) => setError(toMessage(err)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => removeDocumentLink(accessToken!, id),
    onSuccess: () => { setRemoving(null); queryClient.invalidateQueries({ queryKey: key }) },
    onError: (err) => { setRemoving(null); setError(toMessage(err)) },
  })

  return (
    <Panel>
      <PanelHeading title="Documents" />
      {error ? <PanelAlert>{error}</PanelAlert> : null}

      {canManage ? (
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Field label="Name" htmlFor="doc-name">
            <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="SRS v1" />
          </Field>
          <Field label="Web address" htmlFor="doc-url">
            <Input id="doc-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/..." />
          </Field>
          <Button type="button" disabled={!name.trim() || !url.trim().startsWith("https://") || add.isPending} onClick={() => add.mutate()} className="h-9 bg-[#17191C] text-[12px] font-bold text-white">
            {add.isPending ? "Saving…" : "Add link"}
          </Button>
          {badAddress ? (
            <p role="alert" className="text-[11.5px] font-semibold text-[#B03A3A] sm:col-span-3">
              The web address must start with https://
            </p>
          ) : null}
          <p className={`text-[11.5px] sm:col-span-3 ${TONE.muted}`}>
            The link is saved with the current stage: {STAGE_LABEL[deal.stage]}.
          </p>
        </div>
      ) : null}

      {query.isPending ? (
        <div className="space-y-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
      ) : query.isError ? (
        <PanelAlert>{toMessage(query.error)}</PanelAlert>
      ) : query.data.length === 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>No document links yet. Add a link to a file, such as an SRS or a Proposal.</p>
      ) : (
        <ul className="divide-y divide-[#E4E9EF]">
          {query.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold hover:underline">
                {d.name} <RiExternalLinkLine className="size-3.5" aria-hidden />
              </a>
              <span className={`text-[12px] ${TONE.muted}`}>
                {STAGE_LABEL[d.stage]} · {d.createdByName ?? "Someone"} · {new Date(d.createdAt).toLocaleDateString()}
              </span>
              {d.canRemove ? (
                <Button type="button" variant="link" onClick={() => setRemoving(d.id)} className="ml-auto h-auto p-0 text-[12px] font-bold text-[#B03A3A]">
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDeleteDialog open={removing !== null} what="this link" pending={remove.isPending} onCancel={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing)} />
    </Panel>
  )
}
