"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from "@/lib/api/announcements"
import { ApiError } from "@/lib/api/client"
import { listDepartments } from "@/lib/api/departments"
import { useSession } from "@/lib/auth/session-context"
import { REFERENCE_STALE_MS } from "@/lib/query/default-options"
import {
  RiBuilding2Line,
  RiDraftLine,
  RiGroupLine,
  RiMegaphoneLine,
  RiShieldUserLine,
  RiTimeLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import { MiniStat, PageHeader } from "@/components/dashboard/page-header"
import { ConfirmDialog, PanelAlert, RowActions } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { AnnouncementItem, CreateAnnouncementInput } from "@/lib/api/types"
import { ComposeAnnouncementDialog } from "@/components/announcements/compose-announcement-dialog"

/** Roles the server lets publish. Mirrors `PUBLISHER_ROLES`. */
const PUBLISHER_ROLES = ["SUPER_ADMIN", "HR_ADMIN", "FINANCE_OFFICER", "REPORTING_MANAGER"]
const MODERATOR_ROLES = ["SUPER_ADMIN", "HR_ADMIN"]

/**
 * Who a notice reaches, as a glyph and a phrase.
 *
 * The label used to be the bare word "Everyone" sitting in a metadata line
 * beside a date, which gives a first-time reader nothing to tell them it is an
 * audience rather than a status. The verb carries that now, and the icon says
 * it again before the words are read.
 */
function audienceOf(a: AnnouncementItem): { icon: RemixiconComponentType; label: string } {
  if (a.audience === "ALL") return { icon: RiGroupLine, label: "Everyone at the company" }
  if (a.audience === "DEPARTMENT") {
    return { icon: RiBuilding2Line, label: a.departmentName ?? "One department" }
  }
  return {
    icon: RiShieldUserLine,
    label: a.targetRole ? sentenceCase(a.targetRole) : "One role",
  }
}

/** "HR_ADMIN" → "HR admins". Role names are the only shouty strings on the card. */
function sentenceCase(role: string): string {
  const words = role.replace(/_/g, " ").toLowerCase()
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}s`
}

const stamp = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

type NoticeState = "draft" | "scheduled" | "published"

/**
 * One notice, sized to be read.
 *
 * The state is carried by the card itself rather than by a pill in a column:
 * a draft is visibly unfinished (dashed edge, muted), a scheduled one is
 * visibly pending (accent rule down its left), a published one is plain. That
 * makes the answer to "has this gone out?" a glance instead of a read.
 */
function NoticeCard({
  announcement: a,
  state,
  index,
  onEdit,
  onDelete,
}: {
  announcement: AnnouncementItem
  state: NoticeState
  /** Position in its group, for the entrance stagger. */
  index: number
  onEdit?: () => void
  onDelete?: () => void
}) {
  const audience = audienceOf(a)
  const AudienceIcon = audience.icon

  return (
    <article
      // Entrance: one short rise-and-fade, staggered a frame apart down the
      // list, so a set of notices arrives rather than appearing. Capped so a
      // long list does not make the last card wait on the first twenty.
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
      className={cn(
        "group relative rounded-md border bg-white p-4 sm:p-5",
        "animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-300 ease-out",
        "transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-[#CFD7E0] hover:shadow-[0_10px_24px_-16px_rgba(28,39,51,0.35)]",
        // Motion is a courtesy here, not information: the border and shadow
        // still answer the hover without it.
        "motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        state === "draft"
          ? "border-dashed border-[#D4DBE4]"
          : state === "scheduled"
            ? "border-[#E4E9EF] before:absolute before:inset-y-3 before:left-0 before:w-0.75 before:rounded-full before:bg-[#C79A2E]"
            : "border-[#E4E9EF]"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "text-[14.5px] font-bold text-[#17191C]",
              state === "draft" && "text-[#5F6B7C]"
            )}
          >
            {a.title}
          </h3>
          {/* Two lines of the actual notice, wrapped at a word. The table cut
              it at 70 characters mid-word, which is the one thing on the row
              somebody actually wanted to read. */}
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-[#4A5563]">{a.body}</p>
        </div>

        {/* Quiet until the row is hovered or focused within, so a list of
            notices reads as notices rather than as a wall of controls. Always
            visible on touch, where there is no hover to reveal them. */}
        {onEdit || onDelete ? (
          <div className="shrink-0 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <RowActions
              actions={[
                ...(onEdit ? [{ kind: "edit" as const, label: "Edit", onClick: onEdit }] : []),
                ...(onDelete
                  ? [{ kind: "delete" as const, label: "Delete", onClick: onDelete }]
                  : []),
              ]}
            />
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-[#6B7789]">
        {/* A chip, not a bare word. "Everyone" floating beside a date reads as
            a status; the verb and the glyph together say it is an audience. */}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1F4F8] py-1 pr-2.5 pl-2 font-semibold text-[#4A5563]">
          <AudienceIcon className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
          {state === "published" ? "Sent to" : "Goes to"} {audience.label}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <RiTimeLine className="size-3.5 shrink-0 text-[#A5AFBE]" aria-hidden />
          {a.publishedAt === null
            ? "Not published"
            : state === "scheduled"
              ? `Goes live ${stamp(a.publishedAt)}`
              : stamp(a.publishedAt)}
        </span>
      </div>
    </article>
  )
}

/** Two audiences, two different truths about why the list is empty. */
function EmptyNotices({
  canPublish,
  onCompose,
}: {
  canPublish: boolean
  onCompose: () => void
}) {
  return (
    <div className="animate-in fade-in-0 rounded-md border border-[#E4E9EF] bg-white px-6 py-12 text-center duration-300 motion-reduce:animate-none">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-[#F1F4F8] text-[#8A94A2]">
        <RiMegaphoneLine className="size-5" aria-hidden />
      </span>
      <div className="text-[13.5px] font-bold">No announcements yet</div>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-[12.5px] leading-relaxed text-[#5F6B7C]">
        {canPublish
          ? "Post one and it reaches everyone, a department or a single role. Schedule it and it goes live on its own."
          : "Notices from HR and your manager appear here."}
      </p>
      {canPublish ? (
        <Button type="button" className="mt-4" onClick={onCompose}>
          New announcement
        </Button>
      ) : null}
    </div>
  )
}

export function AnnouncementsPage() {
  const { accessToken, user, status } = useSession()
  const queryClient = useQueryClient()

  const isAuthed = status === "authenticated" && !!accessToken
  const role = user?.role
  const canPublish = !!role && PUBLISHER_ROLES.includes(role)
  const isModerator = !!role && MODERATOR_ROLES.includes(role)
  const isManager = role === "REPORTING_MANAGER"

  const [composing, setComposing] = useState(false)
  const [editing, setEditing] = useState<AnnouncementItem | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // Delete used to fire on the click, from a link-styled control sitting
  // beside Edit. An announcement is not recoverable once gone, and the two
  // controls are one pixel apart.
  const [deleting, setDeleting] = useState<AnnouncementItem | null>(null)

  const listQuery = useQuery({
    queryKey: ["announcements"],
    queryFn: () => listAnnouncements(accessToken!, 50),
    enabled: isAuthed,
  })

  // Read once on mount, not on every render: "scheduled" versus "published"
  // is a comparison against the clock, and re-reading it mid-render would let
  // a row's label change because React happened to re-run. A row that crosses
  // its publish time while the page is open is picked up by the next refetch,
  // which is the same moment its content could have changed anyway.
  const [now] = useState(() => new Date().toISOString())

  const departmentsQuery = useQuery({
    queryKey: ["departments"],
    staleTime: REFERENCE_STALE_MS,
    queryFn: () => listDepartments(accessToken!),
    enabled: isAuthed && canPublish,
  })

  function close() {
    setComposing(false)
    setEditing(null)
    setFormError(null)
    queryClient.invalidateQueries({ queryKey: ["announcements"] })
    // A published announcement emits an event, which the feed reads.
    queryClient.invalidateQueries({ queryKey: ["dashboard"] })
  }

  const onError = (err: unknown) =>
    setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")

  const createMutation = useMutation({
    mutationFn: (input: CreateAnnouncementInput) => createAnnouncement(accessToken!, input),
    onSuccess: close,
    onError,
  })

  const updateMutation = useMutation({
    mutationFn: (vars: { id: string; input: CreateAnnouncementInput }) =>
      updateAnnouncement(accessToken!, vars.id, vars.input),
    onSuccess: close,
    onError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAnnouncement(accessToken!, id),
    onSuccess: close,
    onError,
  })

  const items = listQuery.data ?? []

  const thisMonth = items.filter((a) => {
    if (!a.publishedAt || a.publishedAt > now) return false
    const at = new Date(a.publishedAt)
    const today = new Date()
    return at.getMonth() === today.getMonth() && at.getFullYear() === today.getFullYear()
  }).length
  const scheduled = items.filter((a) => a.publishedAt !== null && a.publishedAt > now).length
  const drafts = items.filter((a) => a.publishedAt === null).length

  const canEdit = (a: AnnouncementItem) =>
    canPublish && (isModerator || a.publishedBy === user?.id)

  /**
   * Three groups, in the order a publisher needs them: what is unfinished,
   * what is on its way, what has gone out. An employee only ever has the last
   * one, so they see a plain list with no headings at all.
   */
  const groups = [
    {
      key: "draft",
      heading: "Drafts",
      icon: RiDraftLine,
      note: "Nobody can see these yet",
      items: [] as AnnouncementItem[],
    },
    {
      key: "scheduled",
      heading: "Scheduled",
      icon: RiTimeLine,
      note: "Goes live on its own",
      items: [] as AnnouncementItem[],
    },
    {
      key: "published",
      heading: "Published",
      icon: RiMegaphoneLine,
      note: null as string | null,
      items: [] as AnnouncementItem[],
    },
  ]
  for (const a of items) {
    const bucket = a.publishedAt === null ? 0 : a.publishedAt > now ? 1 : 2
    groups[bucket].items.push(a)
  }
  const visibleGroups = groups.filter((g) => g.items.length > 0)

  const isLoading = status === "loading" || listQuery.isPending

  return (
    <>
      {/* The shared header, not a hand-rolled one. It also survives loading:
          replacing the whole page with two skeletons meant the title and the
          New announcement button vanished and then jumped back. */}
      <PageHeader
        kicker="Communication"
        title="Announcements"
        sub="Company and team notices. There are no read receipts, so a rendered row is not a person who read it."
        cta={canPublish ? "New announcement" : undefined}
        onCta={() => {
          setFormError(null)
          setComposing(true)
        }}
      />

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {/* Counted against no data these read "0", which is a claim rather
            than a smaller version of the truth. On a failed load they are
            dropped: the panel below says what happened, and three zeroes above
            it would argue with that. Same rule the employees directory keeps. */}
        {isLoading || listQuery.isError ? null : (
          <>
            <MiniStat label="This month" value={String(thisMonth)} sub="Published and live" />
            {/* Scheduled and drafts are only meaningful to somebody who can
                publish — an employee sees neither, because neither is visible
                to them in the first place. */}
            {canPublish ? (
              <>
                <MiniStat
                  label="Scheduled"
                  value={String(scheduled)}
                  sub="Goes live on its own, no action needed"
                />
                <MiniStat label="Drafts" value={String(drafts)} sub="Nobody can see these yet" />
              </>
            ) : null}
          </>
        )}
      </div>

      {/* A notice is something a person reads, not a record they scan by
          column. As a table the body was sliced to 70 characters and dropped
          into a sub-line, so the one thing an announcement is *for* was the
          least readable part of the row. */}
      <div className="pt-7">
        {isLoading ? (
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-md border border-[#E4E9EF] bg-white p-4 sm:p-5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="mt-2.5 h-3 w-full" />
                <Skeleton className="mt-1.5 h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : listQuery.isError ? (
          <PanelAlert>
            The announcements could not be loaded.{" "}
            <Button
              variant="link"
              className="h-auto p-0 font-semibold underline"
              onClick={() => listQuery.refetch()}
            >
              Try again
            </Button>
          </PanelAlert>
        ) : items.length === 0 ? (
          <EmptyNotices
            canPublish={canPublish}
            onCompose={() => {
              setFormError(null)
              setComposing(true)
            }}
          />
        ) : (
          <div className="space-y-7">
            {visibleGroups.map((group) => (
              <section key={group.key}>
                {/* Headings only where there is something to separate. One
                    group means one list, and a lone "Published" heading over
                    everything an employee can see is a label for nothing. */}
                {visibleGroups.length > 1 ? (
                  <div className="mb-2.5 flex items-center gap-2">
                    <group.icon className="size-4 shrink-0 text-[#8A94A2]" aria-hidden />
                    <h2 className="text-[13px] font-bold">{group.heading}</h2>
                    <span className="rounded-full bg-[#F1F4F8] px-1.5 py-px text-[11px] font-bold text-[#5F6B7C] tabular-nums">
                      {group.items.length}
                    </span>
                    {group.note ? (
                      <span className="text-[12px] text-[#8A94A2]">{group.note}</span>
                    ) : null}
                  </div>
                ) : null}

                <div className="space-y-2.5">
                  {group.items.map((a, i) => (
                    <NoticeCard
                      key={a.id}
                      announcement={a}
                      state={group.key as NoticeState}
                      index={i}
                      onEdit={
                        canEdit(a)
                          ? () => {
                              setFormError(null)
                              setEditing(a)
                            }
                          : undefined
                      }
                      onDelete={canEdit(a) ? () => setDeleting(a) : undefined}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this announcement?"
        body={
          deleting?.publishedAt && deleting.publishedAt <= now
            ? `"${deleting.title}" is already live. Deleting removes it for everyone who has not read it yet, and it cannot be restored.`
            : `"${deleting?.title ?? ""}" will be removed. This cannot be undone.`
        }
        confirmLabel="Delete"
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target) deleteMutation.mutate(target.id)
        }}
      />

      {composing || editing ? (
        <ComposeAnnouncementDialog
          key={editing?.id ?? "new"}
          open
          onOpenChange={(open) => {
            if (!open) {
              setComposing(false)
              setEditing(null)
            }
          }}
          existing={editing ?? undefined}
          departments={departmentsQuery.data ?? []}
          managerScoped={isManager}
          pending={createMutation.isPending || updateMutation.isPending}
          error={formError}
          onSubmit={(input) =>
            editing
              ? updateMutation.mutate({ id: editing.id, input })
              : createMutation.mutate(input)
          }
        />
      ) : null}
    </>
  )
}
