"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiExternalLinkLine } from "@remixicon/react"

import { addDocumentLink, listDocumentLinks } from "@/lib/api/sales/opportunities"
import { salesKeys } from "@/lib/api/sales/keys"
import { STAGE_LINK_FIELDS } from "@/lib/api/sales/stages"
import { useSession } from "@/lib/auth/session-context"
import type { OpportunitySummary } from "@/lib/api/types"
import { Field, PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The link box a stage asks for: "Design files" at Discovery & Solution
 * Design, "Quotation documents" at Commercial Proposal & Negotiation.
 *
 * It lists the links added at the stage the deal is at now, and says so
 * plainly when there are none. It is a reminder and never a gate: the stage
 * can be changed with or without a link. Removing a link, and links from other
 * stages, stay on the Documents tab.
 */
export function StageLinks({ deal, canManage }: { deal: OpportunitySummary; canManage: boolean }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const config = STAGE_LINK_FIELDS[deal.stage]
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)

  const key = salesKeys.opportunityDocuments(deal.id)
  const query = useQuery({
    queryKey: key,
    queryFn: () => listDocumentLinks(accessToken!, deal.id),
    enabled: !!accessToken && !!config,
  })
  const add = useMutation({
    mutationFn: () => addDocumentLink(accessToken!, deal.id, { name: name.trim(), url: url.trim() }),
    onSuccess: () => {
      setName("")
      setUrl("")
      setError(null)
      queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (err) => setError(toMessage(err)),
  })

  // After the hooks: a stage with no link box renders nothing.
  if (!config) return null

  const links = (query.data ?? []).filter((d) => d.stage === deal.stage)
  const badAddress = url.trim() !== "" && !url.trim().startsWith("https://")
  const canAdd = name.trim() !== "" && url.trim().startsWith("https://") && !add.isPending

  return (
    <div className="mt-4 border-t border-[#E4E9EF] pt-4">
      <div className="text-[13px] font-bold">{config.title}</div>

      {error ? (
        <div className="mt-2">
          <PanelAlert>{error}</PanelAlert>
        </div>
      ) : null}

      {query.isPending ? (
        <div className="mt-2">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : query.isError ? (
        <div className="mt-2">
          <PanelAlert>{toMessage(query.error)}</PanelAlert>
        </div>
      ) : links.length === 0 ? (
        <p className={`mt-1 text-[12.5px] ${TONE.muted}`}>{config.empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-[#E4E9EF]">
          {links.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-semibold hover:underline"
              >
                {d.name} <RiExternalLinkLine className="size-3.5" aria-hidden />
              </a>
              <span className={`text-[12px] ${TONE.muted}`}>
                {d.createdByName ?? "Someone"} · {new Date(d.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Field label="Name" htmlFor="stage-link-name">
            <Input
              id="stage-link-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={config.namePlaceholder}
            />
          </Field>
          <Field label="Web address" htmlFor="stage-link-url">
            <Input
              id="stage-link-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
            />
          </Field>
          <Button
            type="button"
            disabled={!canAdd}
            onClick={() => add.mutate()}
            className="h-9 bg-[#17191C] text-[12px] font-bold text-white"
          >
            {add.isPending ? "Saving…" : "Add link"}
          </Button>
          {badAddress ? (
            <p role="alert" className="text-[11.5px] font-semibold text-[#B03A3A] sm:col-span-3">
              The web address must start with https://
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
