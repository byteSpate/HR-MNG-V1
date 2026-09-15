"use client"

/**
 * `/sales/settings`: Sales Settings, for Sales Admins only (revision §25.30).
 *
 * The minutes template is its first section; later hub settings join it here.
 * The server refuses anybody else, and the menu does not offer the page to
 * them, but somebody who types the address is told plainly rather than shown
 * a form that cannot save.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiRefreshLine,
} from "@remixicon/react"

import { getMinutesTemplate, saveMinutesTemplate } from "@/lib/api/sales"
import { salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type { MinutesKind, MinutesTemplate, MinutesTemplateSection } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { CheckboxField, FormError, PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { MINUTES_KIND_LABEL, shortDay } from "@/components/sales/sales-shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

const KINDS = Object.keys(MINUTES_KIND_LABEL) as MinutesKind[]

const PRIMARY = "h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const QUIET =
  "h-auto rounded-md px-3.5 py-2 text-[12.5px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"

export function SalesSettingsPage() {
  const { user, status } = useSession()
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")

  return (
    <>
      <PageHeader
        kicker="Sales"
        title="Sales Settings"
        sub="How the Sales Hub works for everyone. Only Sales Admins can change these."
      />
      {status === "loading" ? (
        <PanelLoading />
      ) : isSalesAdmin ? (
        <MinutesTemplatePanel />
      ) : (
        <PanelAlert>Sales Settings are for Sales Admins. Ask one if something here needs changing.</PanelAlert>
      )}
    </>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">{children}</section>
}

function PanelLoading() {
  return (
    <Panel>
      <Skeleton className="h-4 w-40" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
      </div>
    </Panel>
  )
}

function MinutesTemplatePanel() {
  const { accessToken, status } = useSession()
  const [saved, setSaved] = useState(false)
  const query = useQuery({
    queryKey: salesKeys.minutesTemplate(),
    queryFn: () => getMinutesTemplate(accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  })

  if (query.isPending) return <PanelLoading />
  if (query.isError) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          <div className="text-[13.5px] font-bold">The minutes template could not be loaded</div>
          <p className={`text-[12.5px] ${TONE.muted}`}>{toMessage(query.error)}</p>
          <Button onClick={() => query.refetch()} className={PRIMARY}>
            <RiRefreshLine className="size-4" aria-hidden />
            Retry
          </Button>
        </div>
      </Panel>
    )
  }

  return (
    <div className="grid gap-3">
      {saved ? (
        <PanelNotice onDismiss={() => setSaved(false)}>
          Saved. Minutes started from now on use this template. Minutes already started keep their sections.
        </PanelNotice>
      ) : null}
      {/* Keyed by when it was saved, so a save starts the form again from what the server kept. */}
      <TemplateEditor
        key={query.data.updatedAt ?? "default"}
        template={query.data}
        onSaved={() => setSaved(true)}
        onEdit={() => setSaved(false)}
      />
    </div>
  )
}

/** Only what the template holds, in a form two lists can be compared on. */
function normalise(sections: MinutesTemplateSection[]) {
  return JSON.stringify(
    sections.map(({ heading, kind, startsWithOutcome }) => ({ heading: heading.trim(), kind, outcome: !!startsWithOutcome }))
  )
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

function TemplateEditor({
  template,
  onSaved,
  onEdit,
}: {
  template: MinutesTemplate
  onSaved: () => void
  onEdit: () => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [sections, setSections] = useState<MinutesTemplateSection[]>(() => template.sections.map((s) => ({ ...s })))
  const [error, setError] = useState<string | null>(null)
  const dirty = normalise(sections) !== normalise(template.sections)

  const save = useMutation({
    mutationFn: () =>
      saveMinutesTemplate(
        accessToken!,
        sections.map((s) => ({
          heading: s.heading.trim(),
          kind: s.kind,
          ...(s.startsWithOutcome && s.kind === "PARAGRAPHS" ? { startsWithOutcome: true } : {}),
        }))
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(salesKeys.minutesTemplate(), next)
      onSaved()
    },
    // Verbatim: the server names the rule the template breaks.
    onError: (err) => setError(toMessage(err)),
  })

  function change(next: MinutesTemplateSection[]) {
    setSections(next)
    setError(null)
    onEdit()
  }

  function update(index: number, patch: Partial<MinutesTemplateSection>) {
    change(sections.map((section, i) => (i === index ? { ...section, ...patch } : section)))
  }

  /** One section starts with the outcome note at most, so ticking one clears the rest. */
  function markOutcome(index: number, on: boolean) {
    change(sections.map((section, i) => ({ ...section, startsWithOutcome: i === index ? on : false })))
  }

  function submit() {
    setError(null)
    if (sections.some((section) => !section.heading.trim())) {
      setError("Give every section a heading.")
      return
    }
    save.mutate()
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[13.5px] font-bold">Minutes template</h2>
          <p className={`mt-0.5 max-w-[68ch] text-[12.5px] leading-relaxed ${TONE.muted}`}>
            New minutes start with these sections, in this order. Minutes already started keep the sections they
            have. A single document can still add its own sections.
          </p>
        </div>
        <span className={`text-[12px] ${TONE.muted}`}>
          {template.isDefault
            ? "The default, from the team's own documents"
            : template.updatedAt
              ? `Last changed ${shortDay(template.updatedAt)}`
              : null}
        </span>
      </div>

      <ol className="mt-4 grid gap-2">
        {sections.map((section, index) => (
          <li key={index} className="rounded-md border border-[#EEF1F5] px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-[13px] font-bold text-[#5F6B7C] tabular-nums">{index + 1}.</span>
              <Input
                aria-label={`Heading of section ${index + 1}`}
                value={section.heading}
                onChange={(e) => update(index, { heading: e.target.value })}
                className="h-9 min-w-[12rem] flex-1 font-semibold"
              />
              <Select
                value={section.kind}
                onValueChange={(v) =>
                  v &&
                  update(index, {
                    kind: v as MinutesKind,
                    // Only a section of paragraphs can hold the outcome note.
                    ...(v === "PARAGRAPHS" ? {} : { startsWithOutcome: false }),
                  })
                }
              >
                <SelectTrigger aria-label={`What section ${index + 1} holds`} className="h-9 w-52">
                  <SelectValue>{(v: string | null) => MINUTES_KIND_LABEL[(v ?? section.kind) as MinutesKind]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {MINUTES_KIND_LABEL[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center">
                <IconButton label="Move up" disabled={index === 0} onClick={() => change(move(sections, index, -1))}>
                  <RiArrowUpLine className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label="Move down"
                  disabled={index === sections.length - 1}
                  onClick={() => change(move(sections, index, 1))}
                >
                  <RiArrowDownLine className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label={`Remove ${section.heading || `section ${index + 1}`}`}
                  disabled={sections.length === 1}
                  onClick={() => change(sections.filter((_, i) => i !== index))}
                >
                  <RiDeleteBinLine className="size-4" aria-hidden />
                </IconButton>
              </div>
            </div>
            {section.kind === "PARAGRAPHS" ? (
              <div className="mt-1 pl-7">
                <CheckboxField
                  label="Starts with the outcome note from Mark completed"
                  checked={!!section.startsWithOutcome}
                  onChange={(on) => markOutcome(index, on)}
                />
              </div>
            ) : section.kind === "TABLE" ? (
              <p className={`mt-1 pl-7 text-[11.5px] ${TONE.muted}`}>
                Its columns are fixed: SL, Action Item, Responsible Person/Team and Status. A row can become a task.
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <Button
        type="button"
        variant="ghost"
        onClick={() => change([...sections, { heading: "", kind: "PARAGRAPHS" }])}
        className="mt-2 h-auto px-2 py-1 text-[12px] font-bold text-[#3D4756] hover:bg-[#F1F4F8]"
      >
        <RiAddLine className="size-3.5" aria-hidden />
        Add a section
      </Button>

      {error ? (
        <div className="mt-3">
          <FormError>{error}</FormError>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-[#EEF1F5] pt-4">
        {dirty ? (
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => change(template.sections.map((s) => ({ ...s })))}
            className={QUIET}
          >
            Discard changes
          </Button>
        ) : null}
        <Button type="button" disabled={!dirty || save.isPending} onClick={submit} className={PRIMARY}>
          {save.isPending ? "Saving…" : dirty ? "Save the template" : "No changes"}
        </Button>
      </div>
    </Panel>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 shrink-0 p-0 text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
    >
      {children}
    </Button>
  )
}
