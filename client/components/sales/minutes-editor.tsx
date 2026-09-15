"use client"

/**
 * `/sales/meetings/minutes/<id>`: writing a meeting's minutes (revision §25).
 *
 * A full page with a Save button (§25.8). What is typed stays on this page
 * until Save, and leaving with unsaved changes asks first. The header's date,
 * time, place and people are read from the meeting (§25.4), so only Purpose
 * and a line under Meeting With are typed here.
 *
 * The PDFs are made from what is saved, so Preview and Download for sending
 * wait until nothing is unsaved: a preview of something other than what the
 * page shows would be a preview of the wrong document.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowLeftLine,
  RiArrowUpLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDownload2Line,
  RiEyeLine,
} from "@remixicon/react"

import {
  answerMinutesRequirement,
  deleteMinutes,
  getMinutes,
  getSentMinutesCopy,
  listMeetingAttendeeOptions,
  previewMinutes,
  saveMinutes,
  sendMinutes,
} from "@/lib/api/sales"
import { planWriteKeys, salesKeys } from "@/lib/api/sales-keys"
import { useSession } from "@/lib/auth/session-context"
import type {
  MinutesBullet,
  MinutesKind,
  MinutesSectionBody,
  MinutesTableRowBody,
  MinutesTopic,
  SalesMinutesDetail,
} from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import {
  CheckboxField,
  ConfirmDeleteDialog,
  DialogActions,
  Field,
  FormError,
  PanelAlert,
  TONE,
  toMessage,
} from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { downloadBlob } from "@/components/payroll/payroll-shared"
import { OpportunityFormDialog } from "@/components/sales/opportunity-form-dialog"
import { TaskFormDialog } from "@/components/sales/task-dialogs"
import {
  MINUTES_KIND_LABEL,
  MINUTES_STATUS_LABEL,
  MINUTES_STATUS_TONE,
  dateOnlyOf,
  meetingWhen,
  shortDay,
} from "@/components/sales/sales-shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

/** First-plan decision 21: a follow-up is offered 15 days out. */
const FOLLOW_UP_DAYS = 15
const KINDS = Object.keys(MINUTES_KIND_LABEL) as MinutesKind[]

const PRIMARY = "h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const OUTLINE =
  "h-auto rounded-md border border-[#E4E9EF] bg-white px-3.5 py-2 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
const QUIET =
  "h-auto rounded-md px-3.5 py-2 text-[12.5px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733]"
const ADD = "h-auto px-2 py-1 text-[12px] font-bold text-[#3D4756] hover:bg-[#F1F4F8]"

// ── the draft ────────────────────────────────────────────────────────────────

type SectionDraft = MinutesSectionBody & { key: string }
interface PreparerDraft {
  employeeId: string
  name: string
  title: string | null
  titleExtra: string
}
interface Draft {
  purpose: string
  meetingWithNote: string
  sections: SectionDraft[]
  preparers: PreparerDraft[]
}

let sectionSeq = 0
/** A stable key per section, so moving one does not remount the boxes being typed in. */
const newKey = () => `section-${++sectionSeq}`

const inDays = (days: number) => dateOnlyOf(new Date(Date.now() + days * 86_400_000))

function emptyContent(kind: MinutesKind): MinutesSectionBody {
  switch (kind) {
    case "PARAGRAPHS":
      return { heading: "", kind, content: { paragraphs: [] } }
    case "BULLETS":
      return { heading: "", kind, content: { bullets: [] } }
    case "SUBTOPICS":
      return { heading: "", kind, content: { topics: [] } }
    default:
      return { heading: "", kind: "TABLE", content: { rows: [] } }
  }
}

function draftOf(detail: SalesMinutesDetail): Draft {
  return {
    purpose: detail.purpose ?? "",
    meetingWithNote: detail.meetingWithNote ?? "",
    // A copy, so typing never changes the cached document.
    sections: detail.sections.map((section) => ({ ...(structuredClone(section) as MinutesSectionBody), key: newKey() })),
    preparers: detail.preparers.map((p) => ({
      employeeId: p.employeeId,
      name: p.name,
      title: p.title,
      titleExtra: p.titleExtra ?? "",
    })),
  }
}

/** What Save sends, and so what "unsaved" is judged on. The keys are the page's own. */
function bodyOf(draft: Draft) {
  return {
    purpose: draft.purpose.trim() || null,
    meetingWithNote: draft.meetingWithNote.trim() || null,
    sections: draft.sections.map((section) => {
      const { key, ...rest } = section
      void key
      return rest as MinutesSectionBody
    }),
    preparers: draft.preparers.map((p) => ({ employeeId: p.employeeId, titleExtra: p.titleExtra.trim() || null })),
  }
}

function replaceAt<T>(list: T[], index: number, value: T): T[] {
  return list.map((item, i) => (i === index ? value : item))
}

function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index)
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** "13 Sep 2026, 11:05", in the viewer's time. */
function stamp(iso: string): string {
  const date = new Date(iso)
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return `${shortDay(iso)} ${date.getFullYear()}, ${time}`
}

/**
 * Asks before leaving with unsaved changes (§25.8). The browser asks on a
 * reload or a closed tab; in-app links are caught before Next's own handler,
 * so saying no leaves the page exactly as it was.
 */
function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return
      if (anchor.origin !== window.location.origin || anchor.pathname === window.location.pathname) return
      if (!window.confirm("You have changes that are not saved. Leave this page without saving them?")) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    document.addEventListener("click", click, true)
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      document.removeEventListener("click", click, true)
    }
  }, [active])
}

// ── the page ─────────────────────────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/sales/meetings/minutes"
      className="mb-3 inline-flex items-center gap-1 text-[12.5px] font-bold text-[#5F6B7C] hover:text-[#1C2733] hover:underline"
    >
      <RiArrowLeftLine className="size-4" aria-hidden />
      Meeting Minutes
    </Link>
  )
}

export function MinutesEditor({ minutesId }: { minutesId: string }) {
  const { accessToken, status } = useSession()
  const query = useQuery({
    queryKey: salesKeys.minutes(minutesId),
    queryFn: () => getMinutes(accessToken!, minutesId),
    enabled: status === "authenticated" && !!accessToken,
  })

  if (status === "loading" || query.isPending) {
    return (
      <>
        <BackLink />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4 rounded-md border border-[#E4E9EF] bg-white px-5 py-5">
            <Skeleton className="mx-auto h-5 w-72" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-48 w-full" />
        </div>
      </>
    )
  }

  if (query.isError) {
    // The server's own sentence: "Those minutes do not exist, or are not yours".
    return (
      <>
        <BackLink />
        <PanelAlert>{toMessage(query.error)}</PanelAlert>
        <Button onClick={() => query.refetch()} className={`mt-3 ${OUTLINE}`}>
          Try again
        </Button>
      </>
    )
  }

  return <MinutesDocument key={query.data.id} detail={query.data} />
}

function MinutesDocument({ detail }: { detail: SalesMinutesDetail }) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const router = useRouter()
  const docKey = salesKeys.minutes(detail.id)

  const [draft, setDraft] = useState<Draft>(() => draftOf(detail))
  const [baseline, setBaseline] = useState(() => JSON.stringify(bodyOf(draftOf(detail))))
  const dirty = JSON.stringify(bodyOf(draft)) !== baseline
  useLeaveGuard(dirty)

  const refreshLists = () => {
    for (const key of planWriteKeys()) queryClient.invalidateQueries({ queryKey: key })
  }

  // ── save ──
  const [saveError, setSaveError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => saveMinutes(accessToken!, detail.id, bodyOf(draft)),
    onSuccess: (saved) => {
      queryClient.setQueryData(docKey, saved)
      // The server's copy, cleaned of blank rows and with any tasks it made.
      const next = draftOf(saved)
      setDraft(next)
      setBaseline(JSON.stringify(bodyOf(next)))
      refreshLists()
    },
    // Verbatim: a refused preparer is named in the server's sentence.
    onError: (err) => setSaveError(toMessage(err)),
  })

  function submit() {
    setSaveError(null)
    if (draft.sections.some((section) => !section.heading.trim())) {
      setSaveError("Give every section a heading.")
      return
    }
    save.mutate()
  }

  // ── the requirement question ──
  const [dealOpen, setDealOpen] = useState(false)
  const [taskOpen, setTaskOpen] = useState(false)
  const answer = useMutation({
    mutationFn: (found: boolean) => answerMinutesRequirement(accessToken!, detail.id, found),
    onSuccess: (next, found) => {
      // Only the answer changes; the draft on the page is left as it is.
      queryClient.setQueryData(docKey, next)
      if (found) setDealOpen(true)
      else setTaskOpen(true)
    },
  })

  // ── PDFs ──
  const [previewing, setPreviewing] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  async function openPreview() {
    setPdfError(null)
    // Opened on the click itself: a window opened after the wait is what a
    // pop-up blocker stops. If one is stopped anyway, the preview downloads.
    const win = window.open("", "_blank")
    setPreviewing(true)
    try {
      const blob = await previewMinutes(accessToken!, detail.id)
      if (win) {
        const url = URL.createObjectURL(blob)
        win.location.href = url
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } else {
        downloadBlob(blob, `DRAFT ${detail.fileName}`)
      }
    } catch (err) {
      win?.close()
      setPdfError(toMessage(err))
    } finally {
      setPreviewing(false)
    }
  }

  const [sendOpen, setSendOpen] = useState(false)
  const copy = useMutation({
    mutationFn: async (send: { id: string; fileName: string }) =>
      downloadBlob(await getSentMinutesCopy(accessToken!, send.id), send.fileName),
    onError: (err) => setPdfError(toMessage(err)),
  })

  // ── delete ──
  const [deleteOpen, setDeleteOpen] = useState(false)
  const remove = useMutation({
    mutationFn: () => deleteMinutes(accessToken!, detail.id),
    onSuccess: () => {
      refreshLists()
      queryClient.removeQueries({ queryKey: docKey })
      router.replace("/sales/meetings/minutes")
    },
  })

  const blockers = [
    dirty ? "Save your changes first. The PDF is made from what is saved." : null,
    detail.asksRequirement && detail.requirementFound === null
      ? "Say whether a requirement was found, above the sections."
      : null,
    detail.preparers.length === 0 ? "Name who prepared the minutes, under Prepared by, and save." : null,
  ].filter((line): line is string => line !== null)

  const setSections = (update: (sections: SectionDraft[]) => SectionDraft[]) =>
    setDraft((d) => ({ ...d, sections: update(d.sections) }))

  return (
    <>
      <BackLink />
      <PageHeader
        kicker="Sales"
        title={detail.title}
        sub={`${detail.subtitle} · ${meetingWhen(detail.meeting.scheduledAt)}`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid min-w-0 content-start gap-4">
          <HeaderCard detail={detail} draft={draft} setDraft={setDraft} />
          <AttendeesCard detail={detail} />
          {detail.asksRequirement ? (
            <RequirementCard
              detail={detail}
              pending={answer.isPending}
              error={answer.error ? toMessage(answer.error) : null}
              onAnswer={(found) => answer.mutate(found)}
              onMakeDeal={() => setDealOpen(true)}
              onMakeTask={() => setTaskOpen(true)}
            />
          ) : null}
          <SectionsCard sections={draft.sections} setSections={setSections} />
          <PreparersCard
            preparers={draft.preparers}
            companyName={detail.companyName}
            onChange={(preparers) => setDraft((d) => ({ ...d, preparers }))}
          />
        </div>

        <aside className="grid content-start gap-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-bold">This document</span>
              <Tag label={MINUTES_STATUS_LABEL[detail.status]} tone={MINUTES_STATUS_TONE[detail.status]} />
            </div>
            <p className={`mt-1 text-[12px] ${TONE.muted}`}>
              {detail.lastSentAt ? `Last sent ${stamp(detail.lastSentAt)}` : "Not sent yet"}
            </p>

            {saveError ? (
              <div className="mt-3">
                <FormError>{saveError}</FormError>
              </div>
            ) : null}
            <div className="mt-3 grid gap-2">
              <Button type="button" onClick={submit} disabled={!dirty || save.isPending} className={PRIMARY}>
                {save.isPending ? "Saving…" : dirty ? "Save" : "All changes saved"}
              </Button>
              {dirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    setDraft(draftOf(detail))
                    setSaveError(null)
                  }}
                  className={QUIET}
                >
                  Discard changes
                </Button>
              ) : null}
            </div>

            <div className="mt-4 grid gap-2 border-t border-[#EEF1F5] pt-4">
              <Button type="button" onClick={openPreview} disabled={dirty || previewing} className={OUTLINE}>
                <RiEyeLine className="size-4" aria-hidden />
                {previewing ? "Making the preview…" : "Preview"}
              </Button>
              <Button type="button" onClick={() => setSendOpen(true)} disabled={blockers.length > 0} className={OUTLINE}>
                <RiDownload2Line className="size-4" aria-hidden />
                Download for sending
              </Button>
              {blockers.length > 0 ? (
                <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] leading-relaxed text-[#8A5E0C]">
                  {blockers.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
              <p className={`text-[11.5px] leading-relaxed ${TONE.muted}`}>
                Preview marks every page DRAFT. Download for sending keeps that exact copy here and marks the minutes
                sent. You send it from your own email; the app does not email the customer.
              </p>
              {pdfError ? <FormError>{pdfError}</FormError> : null}
            </div>
          </Card>

          <Card title="Sent copies">
            {detail.sends.length === 0 ? (
              <p className={`text-[12.5px] ${TONE.muted}`}>None yet. Each copy you download for sending is kept here.</p>
            ) : (
              <ul className="grid gap-2.5">
                {detail.sends.map((send) => (
                  <li key={send.id} className="flex items-start justify-between gap-2 text-[12px]">
                    <div className="min-w-0">
                      <div className="font-semibold text-[#1C2733]">{stamp(send.sentAt)}</div>
                      <div className={TONE.muted}>
                        {[send.sentByName, send.sentTo ? `to ${send.sentTo}` : null].filter(Boolean).join(", ")}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={copy.isPending}
                      onClick={() => copy.mutate(send)}
                      className="h-auto shrink-0 px-2 py-1 text-[12px] font-bold text-[#3D4756] hover:bg-[#F1F4F8]"
                    >
                      Download
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="History">
            {detail.history.length === 0 ? (
              <p className={`text-[12.5px] ${TONE.muted}`}>Nothing yet.</p>
            ) : (
              <ul className="grid gap-2">
                {detail.history.map((line) => (
                  <li key={line.id} className="text-[12px]">
                    <div className="font-semibold text-[#1C2733]">{line.text}</div>
                    <div className={TONE.muted}>{[line.byName, stamp(line.at)].filter(Boolean).join(" · ")}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {detail.canDelete ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(true)}
              className="h-auto justify-self-start rounded-md px-3 py-2 text-[12.5px] font-bold text-[#5F6B7C] hover:bg-[#FDF1F1] hover:text-[#B03A3A]"
            >
              <RiDeleteBinLine className="size-4" aria-hidden />
              Delete these minutes
            </Button>
          ) : null}
        </aside>
      </div>

      <SendDialog
        detail={detail}
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onSent={() => {
          setSendOpen(false)
          queryClient.invalidateQueries({ queryKey: docKey })
          refreshLists()
        }}
      />

      <OpportunityFormDialog
        open={dealOpen}
        onOpenChange={setDealOpen}
        accountId={detail.meeting.salesAccountId}
        fromMeeting={{ id: detail.meeting.id, title: detail.meeting.title }}
        onCreated={() => queryClient.invalidateQueries({ queryKey: docKey })}
      />
      <TaskFormDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        accountId={detail.meeting.salesAccountId}
        meetingId={detail.meeting.id}
        start={{ title: `Follow up with ${detail.meeting.salesAccountName}`, dueOn: inDays(FOLLOW_UP_DAYS) }}
      />
      <ConfirmDeleteDialog
        open={deleteOpen}
        what="these minutes"
        pending={remove.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

// ── cards ────────────────────────────────────────────────────────────────────

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">
      {title ? <h2 className="mb-3 text-[13.5px] font-bold">{title}</h2> : null}
      {children}
    </section>
  )
}

/** The header as the PDF prints it, with the two lines the meeting cannot supply typed in. */
function HeaderCard({
  detail,
  draft,
  setDraft,
}: {
  detail: SalesMinutesDetail
  draft: Draft
  setDraft: React.Dispatch<React.SetStateAction<Draft>>
}) {
  const note = draft.meetingWithNote.trim()
  // Purpose and Meeting With are typed below, so they are shown there instead.
  const lines = detail.header.filter((line) => line.label !== "Purpose" && line.label !== "Meeting With")
  return (
    <Card>
      <h2 className="text-center font-heading text-[18px] font-bold text-balance">{detail.title}</h2>
      <p className={`mt-0.5 text-center text-[13px] ${TONE.muted}`}>{detail.subtitle}</p>
      <dl className="mt-4 grid gap-1 text-[13px]">
        {lines.map((line) => (
          <div key={line.label}>
            <dt className="inline font-bold">{line.label}:</dt> <dd className="inline">{line.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label="Meeting With"
          htmlFor="minutes-with"
          hint={`Prints as “${detail.meeting.salesAccountName}${note ? `, ${note}` : ""}”.`}
          help="The account's name comes from the meeting. Add a line only when it helps, like IT Department."
        >
          <Input
            id="minutes-with"
            value={draft.meetingWithNote}
            placeholder="IT Department"
            onChange={(e) => setDraft((d) => ({ ...d, meetingWithNote: e.target.value }))}
          />
        </Field>
        <Field label="Purpose" htmlFor="minutes-purpose" hint="Optional.">
          <Input
            id="minutes-purpose"
            value={draft.purpose}
            onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))}
          />
        </Field>
      </div>
      <p className={`mt-3 text-[12px] leading-relaxed ${TONE.muted}`}>
        The date, time, place and people come from the meeting, and stay in step with it until the minutes are sent.
        To change them,{" "}
        <Link href={`/sales/accounts/${detail.meeting.salesAccountId}`} className="font-semibold underline">
          edit the meeting on its account
        </Link>
        .
      </p>
    </Card>
  )
}

function AttendeesCard({ detail }: { detail: SalesMinutesDetail }) {
  const named = (a: SalesMinutesDetail["attendees"][number]) => (a.designation ? `${a.name} (${a.designation})` : a.name)
  const groups = [
    { label: `From ${detail.meeting.salesAccountName}`, people: detail.attendees.filter((a) => a.side === "THEIRS") },
    { label: `From ${detail.companyName}`, people: detail.attendees.filter((a) => a.side === "OURS") },
  ].filter((group) => group.people.length > 0)
  return (
    <Card title="Attendees">
      {groups.length === 0 ? (
        <p className={`text-[12.5px] ${TONE.muted}`}>Nobody is listed on the meeting.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="text-[12.5px] font-bold">{group.label}:</div>
              <ul className="mt-1 list-disc pl-5 text-[12.5px] leading-relaxed">
                {group.people.map((person, i) => (
                  <li key={`${person.name}-${i}`}>{named(person)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p className={`mt-3 text-[12px] ${TONE.muted}`}>
        From the meeting. Somebody who did not come is taken off the meeting itself.
      </p>
    </Card>
  )
}

/** The requirement question (§25.6), for a meeting with no deal. */
function RequirementCard({
  detail,
  pending,
  error,
  onAnswer,
  onMakeDeal,
  onMakeTask,
}: {
  detail: SalesMinutesDetail
  pending: boolean
  error: string | null
  onAnswer: (found: boolean) => void
  onMakeDeal: () => void
  onMakeTask: () => void
}) {
  const found = detail.requirementFound
  const choice = (value: boolean) =>
    found === value
      ? "h-9 rounded-md bg-[#17191C] px-3 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
      : "h-9 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
  return (
    <Card title="Was a requirement found?">
      <p className={`text-[12.5px] leading-relaxed ${TONE.muted}`}>
        This meeting has no deal. Say whether the customer has a requirement: Yes makes a deal from this meeting, No
        makes a follow-up task. The answer is needed before sending, and is fixed once the minutes are sent.
      </p>
      {detail.requirementLocked ? (
        <p className="mt-3 text-[12.5px] font-semibold">
          {found ? "Yes, a requirement was found." : "No requirement was found."}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" aria-pressed={found === true} disabled={pending} onClick={() => onAnswer(true)} className={choice(true)}>
            Yes, a requirement
          </Button>
          <Button type="button" aria-pressed={found === false} disabled={pending} onClick={() => onAnswer(false)} className={choice(false)}>
            No requirement
          </Button>
          {found === true && detail.originatedDeals.length === 0 ? (
            <Button type="button" variant="ghost" onClick={onMakeDeal} className={ADD}>
              Make the deal
            </Button>
          ) : null}
          {found === false ? (
            <Button type="button" variant="ghost" onClick={onMakeTask} className={ADD}>
              Make the follow-up task
            </Button>
          ) : null}
        </div>
      )}
      {detail.originatedDeals.length > 0 ? (
        <p className="mt-3 text-[12.5px]">
          Deal made from this meeting:{" "}
          {detail.originatedDeals.map((deal, i) => (
            <span key={deal.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/sales/opportunities/${deal.id}`} className="font-semibold underline">
                {deal.serial} · {deal.name}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      {error ? (
        <div className="mt-3">
          <FormError>{error}</FormError>
        </div>
      ) : null}
    </Card>
  )
}

function SectionsCard({
  sections,
  setSections,
}: {
  sections: SectionDraft[]
  setSections: (update: (sections: SectionDraft[]) => SectionDraft[]) => void
}) {
  const [newHeading, setNewHeading] = useState("")
  const [newKind, setNewKind] = useState<MinutesKind>("PARAGRAPHS")

  function add() {
    if (!newHeading.trim()) return
    setSections((list) => [...list, { ...emptyContent(newKind), heading: newHeading.trim(), key: newKey() }])
    setNewHeading("")
  }

  return (
    <Card title="Sections">
      <p className={`-mt-1 mb-3 text-[12px] leading-relaxed ${TONE.muted}`}>
        Numbered in the PDF by their order; an empty section is left out. To make words bold, put two stars on each
        side: **like this**. Nothing else changes how the text looks.
      </p>
      <div className="grid gap-3">
        {sections.map((section, index) => (
          <SectionCard
            key={section.key}
            section={section}
            number={index + 1}
            first={index === 0}
            last={index === sections.length - 1}
            onChange={(next) => setSections((list) => list.map((s) => (s.key === section.key ? next : s)))}
            onMove={(delta) => setSections((list) => move(list, index, delta))}
            onRemove={() => setSections((list) => list.filter((s) => s.key !== section.key))}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-2 border-t border-[#EEF1F5] pt-4 sm:grid-cols-[minmax(0,1fr)_14rem_auto]">
        <Input
          aria-label="Heading of a new section"
          placeholder="Add a section, like Client Feedback"
          value={newHeading}
          onChange={(e) => setNewHeading(e.target.value)}
        />
        <Select value={newKind} onValueChange={(v) => v && setNewKind(v as MinutesKind)}>
          <SelectTrigger aria-label="What the new section holds" className="w-full">
            <SelectValue>{(v: string | null) => MINUTES_KIND_LABEL[(v ?? newKind) as MinutesKind]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {MINUTES_KIND_LABEL[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" onClick={add} disabled={!newHeading.trim()} className={OUTLINE}>
          <RiAddLine className="size-4" aria-hidden />
          Add
        </Button>
      </div>
    </Card>
  )
}

function SectionCard({
  section,
  number,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  section: SectionDraft
  number: number
  first: boolean
  last: boolean
  onChange: (next: SectionDraft) => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-md border border-[#EEF1F5] px-3 py-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-5 text-[13px] font-bold text-[#5F6B7C] tabular-nums">{number}.</span>
        <Input
          aria-label={`Heading of section ${number}`}
          value={section.heading}
          onChange={(e) => onChange({ ...section, heading: e.target.value })}
          className="h-9 min-w-[10rem] flex-1 font-semibold"
        />
        <span className={`text-[11.5px] ${TONE.muted}`}>{MINUTES_KIND_LABEL[section.kind]}</span>
        <div className="flex items-center">
          <IconButton label="Move up" disabled={first} onClick={() => onMove(-1)}>
            <RiArrowUpLine className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="Move down" disabled={last} onClick={() => onMove(1)}>
            <RiArrowDownLine className="size-4" aria-hidden />
          </IconButton>
          <IconButton label={`Remove ${section.heading || `section ${number}`}`} onClick={onRemove}>
            <RiDeleteBinLine className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>
      <div className="mt-3 pl-0 sm:pl-7">
        {section.kind === "PARAGRAPHS" ? (
          <ParagraphsEditor
            paragraphs={section.content.paragraphs}
            onChange={(paragraphs) => onChange({ ...section, content: { paragraphs } })}
          />
        ) : section.kind === "BULLETS" ? (
          <BulletsEditor bullets={section.content.bullets} onChange={(bullets) => onChange({ ...section, content: { bullets } })} />
        ) : section.kind === "SUBTOPICS" ? (
          <TopicsEditor
            number={number}
            topics={section.content.topics}
            onChange={(topics) => onChange({ ...section, content: { topics } })}
          />
        ) : (
          <TableEditor rows={section.content.rows} onChange={(rows) => onChange({ ...section, content: { rows } })} />
        )}
      </div>
    </div>
  )
}

// ── content editors ──────────────────────────────────────────────────────────

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

function ParagraphsEditor({ paragraphs, onChange }: { paragraphs: string[]; onChange: (next: string[]) => void }) {
  // One box is always there to type in; an untouched one is not a change.
  const list = paragraphs.length > 0 ? paragraphs : [""]
  return (
    <div className="grid gap-2">
      {list.map((paragraph, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <Textarea
            aria-label={`Paragraph ${i + 1}`}
            value={paragraph}
            rows={3}
            onChange={(e) => onChange(replaceAt(list, i, e.target.value))}
          />
          {list.length > 1 ? (
            <IconButton label={`Remove paragraph ${i + 1}`} onClick={() => onChange(removeAt(list, i))}>
              <RiCloseLine className="size-4" aria-hidden />
            </IconButton>
          ) : null}
        </div>
      ))}
      <Button type="button" variant="ghost" onClick={() => onChange([...list, ""])} className={`justify-self-start ${ADD}`}>
        <RiAddLine className="size-3.5" aria-hidden />
        Add a paragraph
      </Button>
    </div>
  )
}

/** Bullets two levels deep, • and o, as the documents have them. */
function BulletsEditor({ bullets, onChange }: { bullets: MinutesBullet[]; onChange: (next: MinutesBullet[]) => void }) {
  const list = bullets.length > 0 ? bullets : [{ text: "", sub: [] }]
  const update = (i: number, next: MinutesBullet) => onChange(replaceAt(list, i, next))
  return (
    <div className="grid gap-1.5">
      {list.map((bullet, i) => (
        <div key={i} className="grid gap-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-3 text-center text-[#5F6B7C]" aria-hidden>
              •
            </span>
            <Input
              aria-label={`Bullet point ${i + 1}`}
              value={bullet.text}
              onChange={(e) => update(i, { ...bullet, text: e.target.value })}
              className="h-9"
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => update(i, { ...bullet, sub: [...bullet.sub, ""] })}
              className={`shrink-0 ${ADD}`}
            >
              Add a sub-point
            </Button>
            {list.length > 1 ? (
              <IconButton label={`Remove bullet point ${i + 1}`} onClick={() => onChange(removeAt(list, i))}>
                <RiCloseLine className="size-4" aria-hidden />
              </IconButton>
            ) : null}
          </div>
          {bullet.sub.map((sub, j) => (
            <div key={j} className="flex items-center gap-1.5 pl-6">
              <span className="w-3 text-center text-[12px] text-[#5F6B7C]" aria-hidden>
                o
              </span>
              <Input
                aria-label={`Sub-point ${j + 1} of bullet point ${i + 1}`}
                value={sub}
                onChange={(e) => update(i, { ...bullet, sub: replaceAt(bullet.sub, j, e.target.value) })}
                className="h-9"
              />
              <IconButton
                label={`Remove sub-point ${j + 1}`}
                onClick={() => update(i, { ...bullet, sub: removeAt(bullet.sub, j) })}
              >
                <RiCloseLine className="size-4" aria-hidden />
              </IconButton>
            </div>
          ))}
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => onChange([...list, { text: "", sub: [] }])}
        className={`justify-self-start ${ADD}`}
      >
        <RiAddLine className="size-3.5" aria-hidden />
        Add a bullet point
      </Button>
    </div>
  )
}

/** Numbered sub-topics: 2.1, 2.2, each with an optional line of text and its own bullets. */
function TopicsEditor({
  number,
  topics,
  onChange,
}: {
  number: number
  topics: MinutesTopic[]
  onChange: (next: MinutesTopic[]) => void
}) {
  const list = topics.length > 0 ? topics : [{ title: "", text: "", bullets: [] }]
  const update = (i: number, next: MinutesTopic) => onChange(replaceAt(list, i, next))
  return (
    <div className="grid gap-3">
      {list.map((topic, i) => (
        <div key={i} className="grid gap-2 rounded-md bg-[#F7F9FB] px-3 py-3">
          <div className="flex items-center gap-1.5">
            <span className="w-8 text-[12.5px] font-bold text-[#5F6B7C] tabular-nums">
              {number}.{i + 1}
            </span>
            <Input
              aria-label={`Title of sub-topic ${number}.${i + 1}`}
              placeholder="Sub-topic, like Network Infrastructure"
              value={topic.title}
              onChange={(e) => update(i, { ...topic, title: e.target.value })}
              className="h-9 bg-white font-semibold"
            />
            {list.length > 1 ? (
              <IconButton label={`Remove sub-topic ${number}.${i + 1}`} onClick={() => onChange(removeAt(list, i))}>
                <RiCloseLine className="size-4" aria-hidden />
              </IconButton>
            ) : null}
          </div>
          <Textarea
            aria-label={`Text of sub-topic ${number}.${i + 1}`}
            placeholder="A line of text, if it needs one"
            value={topic.text}
            rows={2}
            onChange={(e) => update(i, { ...topic, text: e.target.value })}
            className="bg-white"
          />
          <BulletsEditor bullets={topic.bullets} onChange={(bullets) => update(i, { ...topic, bullets })} />
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        onClick={() => onChange([...list, { title: "", text: "", bullets: [] }])}
        className={`justify-self-start ${ADD}`}
      >
        <RiAddLine className="size-3.5" aria-hidden />
        Add a sub-topic
      </Button>
    </div>
  )
}

/**
 * The Next Steps table. The columns are fixed (§25.19, §25.21). A row can also
 * become a task for the writer (§25.5): ticked here, made on Save, and then
 * linked to the row for good. The row's Status is typed, and is not kept in
 * step with the task.
 */
function TableEditor({ rows, onChange }: { rows: MinutesTableRowBody[]; onChange: (next: MinutesTableRowBody[]) => void }) {
  const blank: MinutesTableRowBody = { actionItem: "", responsible: "", status: "", taskId: null }
  const list = rows.length > 0 ? rows : [blank]
  const update = (i: number, next: MinutesTableRowBody) => onChange(replaceAt(list, i, next))
  return (
    <div className="grid gap-2">
      <div className="hidden gap-2 text-[11px] font-bold tracking-wide text-[#5F6B7C] uppercase sm:grid sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_2rem]">
        <span>SL</span>
        <span>Action item</span>
        <span>Responsible person/team</span>
        <span>Status</span>
        <span />
      </div>
      {list.map((row, i) => (
        <div key={i} className="grid gap-1.5 rounded-md border border-[#EEF1F5] p-2 sm:border-0 sm:p-0">
          <div className="grid items-center gap-2 sm:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_2rem]">
            <span className="text-[12.5px] font-bold text-[#5F6B7C] tabular-nums">{i + 1}</span>
            <Input
              aria-label={`Action item ${i + 1}`}
              value={row.actionItem}
              onChange={(e) => update(i, { ...row, actionItem: e.target.value })}
              className="h-9"
            />
            <Input
              aria-label={`Who is responsible for action item ${i + 1}`}
              placeholder="Bytespate Limited, Both Parties…"
              value={row.responsible}
              onChange={(e) => update(i, { ...row, responsible: e.target.value })}
              className="h-9"
            />
            <Input
              aria-label={`Status of action item ${i + 1}`}
              value={row.status}
              onChange={(e) => update(i, { ...row, status: e.target.value })}
              className="h-9"
            />
            {list.length > 1 ? (
              <IconButton label={`Remove action item ${i + 1}`} onClick={() => onChange(removeAt(list, i))}>
                <RiCloseLine className="size-4" aria-hidden />
              </IconButton>
            ) : (
              <span />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:pl-10">
            {row.taskId ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-[#3D4756]">
                <Tag label="Task made" tone="green" />A task was made from this row.
              </span>
            ) : (
              <>
                <CheckboxField
                  label="Also make it a task for me"
                  checked={!!row.newTask}
                  disabled={!row.actionItem.trim()}
                  onChange={(on) =>
                    update(i, { ...row, newTask: on ? { dueOn: inDays(FOLLOW_UP_DAYS) } : undefined })
                  }
                />
                {row.newTask ? (
                  <label className="flex items-center gap-1.5 text-[12px] text-[#3D4756]">
                    Due
                    <Input
                      type="date"
                      value={row.newTask.dueOn}
                      onChange={(e) => update(i, { ...row, newTask: { dueOn: e.target.value } })}
                      className="h-8 w-40"
                    />
                    <span className={TONE.muted}>Made when you save.</span>
                  </label>
                ) : null}
              </>
            )}
          </div>
        </div>
      ))}
      <Button type="button" variant="ghost" onClick={() => onChange([...list, blank])} className={`justify-self-start ${ADD}`}>
        <RiAddLine className="size-3.5" aria-hidden />
        Add a row
      </Button>
    </div>
  )
}

/** Prepared by (§25.7, §25.15): the writer first; anyone in the hub can be added. */
function PreparersCard({
  preparers,
  companyName,
  onChange,
}: {
  preparers: PreparerDraft[]
  companyName: string
  onChange: (next: PreparerDraft[]) => void
}) {
  const { accessToken } = useSession()
  const [pick, setPick] = useState("")
  const options = useQuery({
    queryKey: salesKeys.meetingAttendees(),
    queryFn: () => listMeetingAttendeeOptions(accessToken!),
    enabled: !!accessToken,
  })
  const available = (options.data ?? []).filter((person) => !preparers.some((p) => p.employeeId === person.id))

  function add() {
    const person = available.find((p) => p.id === pick)
    if (!person) return
    onChange([...preparers, { employeeId: person.id, name: person.fullName, title: person.designation, titleExtra: "" }])
    setPick("")
  }

  return (
    <Card title="Prepared by">
      {preparers.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-[#8A5E0C]">
          Nobody yet. The minutes cannot be sent until somebody is named here.
        </p>
      ) : (
        <ul className="grid gap-3">
          {preparers.map((person, i) => (
            <li key={person.employeeId} className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] sm:items-start">
              <div className="text-[12.5px] leading-relaxed">
                <div className="font-bold text-[#1C2733]">{person.name}</div>
                <div className={TONE.muted}>{person.title ?? "No job title on file"}</div>
                <div className={TONE.muted}>{companyName}</div>
              </div>
              <Input
                aria-label={`Extra line for ${person.name}`}
                placeholder="Extra line, like (Cloud & Cybersecurity)"
                value={person.titleExtra}
                onChange={(e) => onChange(replaceAt(preparers, i, { ...person, titleExtra: e.target.value }))}
                className="h-9"
              />
              <IconButton label={`Take ${person.name} off Prepared by`} onClick={() => onChange(removeAt(preparers, i))}>
                <RiCloseLine className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-[#EEF1F5] pt-4">
        {options.isError ? (
          <PanelAlert>
            <span className="flex flex-wrap items-center gap-2">
              <span>The people who can be added could not be loaded.</span>
              <Button
                type="button"
                variant="link"
                onClick={() => options.refetch()}
                className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
              >
                Try again
              </Button>
            </span>
          </PanelAlert>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={pick} onValueChange={(v) => setPick(v ?? "")} disabled={options.isPending || available.length === 0}>
              <SelectTrigger aria-label="Somebody to add under Prepared by" className="w-full sm:w-72">
                <SelectValue>
                  {(v: string | null) =>
                    available.find((p) => p.id === v)?.fullName ??
                    (options.isPending
                      ? "Loading the people in the hub…"
                      : available.length === 0
                        ? "Everybody in the hub is already named"
                        : "Add somebody from the hub")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {available.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" onClick={add} disabled={!pick} className={OUTLINE}>
              <RiAddLine className="size-4" aria-hidden />
              Add
            </Button>
          </div>
        )}
        <p className={`mt-2 text-[11.5px] leading-relaxed ${TONE.muted}`}>
          Their job title comes from their HR record. The extra line prints under it, on these minutes only.
        </p>
      </div>
    </Card>
  )
}

/** Download for sending (§25.23, §25.24): keeps the copy, marks it sent, downloads the same file. */
function SendDialog({
  detail,
  open,
  onClose,
  onSent,
}: {
  detail: SalesMinutesDetail
  open: boolean
  onClose: () => void
  onSent: () => void
}) {
  const { accessToken } = useSession()
  const [sentTo, setSentTo] = useState("")
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({
    mutationFn: () => sendMinutes(accessToken!, detail.id, sentTo.trim() || null),
    onSuccess: (blob) => {
      downloadBlob(blob, detail.fileName)
      setSentTo("")
      onSent()
    },
    // Verbatim: "The minutes were changed while the PDF was being made…"
    onError: (err) => setError(toMessage(err)),
  })

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download for sending</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-[12.5px] leading-relaxed text-[#3D4756]">
            This keeps this exact copy here, marks the minutes sent, and downloads the file. Send it from your own
            email: the app does not email the customer.
            {detail.lastSentAt ? " Every earlier copy stays listed." : ""}
          </p>
          <Field
            label="Sent to"
            htmlFor="minutes-sent-to"
            hint="Optional."
            help="Who you are sending it to, and how. For example: Md. Salim Reza, by email."
          >
            <Input id="minutes-sent-to" value={sentTo} onChange={(e) => setSentTo(e.target.value)} />
          </Field>
          {error ? <FormError>{error}</FormError> : null}
          <DialogFooter>
            <DialogActions
              pending={send.isPending}
              submitLabel="Download for sending"
              disabled={false}
              onCancel={onClose}
              onSubmit={() => {
                setError(null)
                send.mutate()
              }}
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
