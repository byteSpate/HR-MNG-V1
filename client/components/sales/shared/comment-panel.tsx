"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiChat3Line, RiShieldUserLine, RiUserVoiceLine } from "@remixicon/react"

import { createSalesComment, listSalesComments, updateSalesComment } from "@/lib/api/sales/comments"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { SalesCommentKind, SalesCommentSummary } from "@/lib/api/types"
import { FormError, PanelAlert, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"

/**
 * The running list of what people have written about a record.
 *
 * **One component, two labels.** It renders as **Remarks** on a Sales Account
 * and as **Comments** on an Opportunity, because that is the business's own
 * vocabulary. The two must not be made consistent with each other — renaming
 * a primary label is a decision, not a tidy-up.
 *
 * Entries are added to, never overwritten. An author may correct their own
 * words and the correction is audited; writing a new one never destroys an
 * old one, and there is no delete.
 */

const KIND_LABEL: Record<SalesCommentKind, string> = {
  GENERAL: "Note",
  CUSTOMER_FEEDBACK: "Customer feedback",
  MANAGEMENT_NOTE: "Management note",
}

const KIND_ICON = {
  GENERAL: RiChat3Line,
  CUSTOMER_FEEDBACK: RiUserVoiceLine,
  MANAGEMENT_NOTE: RiShieldUserLine,
} as const

function CommentRow({
  comment,
  canEdit,
  onSaved,
  accessToken,
}: {
  comment: SalesCommentSummary
  canEdit: boolean
  onSaved: () => void
  accessToken: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [error, setError] = useState<string | null>(null)
  const Icon = KIND_ICON[comment.kind]

  const save = useMutation({
    mutationFn: (next: string) => updateSalesComment(accessToken, comment.id, next),
    onSuccess: () => {
      setEditing(false)
      setError(null)
      onSaved()
    },
    // Verbatim. The server's refusal carries the reason — a demoted admin is
    // still the author of a management note but may no longer edit one.
    onError: (err) => setError(toMessage(err)),
  })

  const edited = comment.updatedAt !== comment.createdAt

  return (
    <li className="border-b border-[#E4E9EF] py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Icon className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
        <span className="text-[12.5px] font-semibold">{comment.authorName}</span>
        <span className={`text-[11.5px] ${TONE.muted}`}>{KIND_LABEL[comment.kind]}</span>
        <span className={`text-[11.5px] ${TONE.muted}`}>
          {new Date(comment.createdAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
        {/* Said plainly rather than shown as a silent rewrite: a corrected
            note and an original one are different things to have read. */}
        {edited ? <span className={`text-[11.5px] ${TONE.muted}`}>· edited</span> : null}
        {canEdit && !editing ? (
          <Button
            type="button"
            variant="link"
            onClick={() => {
              setDraft(comment.body)
              setEditing(true)
            }}
            className="ml-auto h-auto p-0 text-[11.5px] font-bold text-[#5F6B7C]"
          >
            Edit
          </Button>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="text-[13px]"
          />
          {error ? <FormError>{error}</FormError> : null}
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              disabled={save.isPending || !draft.trim()}
              onClick={() => save.mutate(draft.trim())}
              className="h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setEditing(false)
                setError(null)
              }}
              className="h-8 p-0 text-[12px] font-bold text-[#5F6B7C]"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap">{comment.body}</p>
      )}
    </li>
  )
}

export function CommentPanel({
  entity,
  entityId,
  label,
  kinds,
  canWrite,
}: {
  entity: "SALES_ACCOUNT" | "OPPORTUNITY"
  entityId: string
  /** "Remarks" on an account, "Comments" on a deal. Deliberately different. */
  label: string
  /**
   * Which kinds this record offers. Management notes are admin-only, and
   * customer feedback is offered on a deal only — feedback is always about a
   * specific deal.
   */
  kinds: SalesCommentKind[]
  canWrite: boolean
}) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const queryClient = useQueryClient()
  const [body, setBody] = useState("")
  const [kind, setKind] = useState<SalesCommentKind>(kinds[0] ?? "GENERAL")
  const [error, setError] = useState<string | null>(null)

  const isAuthed = sessionStatus === "authenticated" && !!accessToken

  const query = useQuery({
    queryKey: salesKeys.comments(entity, entityId),
    queryFn: () => listSalesComments(accessToken!, entity, entityId),
    enabled: isAuthed,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: salesKeys.comments(entity, entityId) })
    // A remark reaches the Timeline too, so the panel beside this one is
    // stale the moment this one is written.
    queryClient.invalidateQueries({
      queryKey:
        entity === "SALES_ACCOUNT"
          ? salesKeys.accountTimeline(entityId)
          : salesKeys.opportunityTimeline(entityId),
    })
    queryClient.invalidateQueries({ queryKey: ["sales", "dashboard"] })
  }

  const add = useMutation({
    mutationFn: () =>
      createSalesComment(accessToken!, { entity, entityId, kind, body: body.trim() }),
    onSuccess: () => {
      setBody("")
      setError(null)
      invalidate()
    },
    onError: (err) => setError(toMessage(err)),
  })

  const items = query.data?.items ?? []

  return (
    <section className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
      <h2 className="font-heading text-[15px] font-bold tracking-tight">{label}</h2>

      {canWrite ? (
        <div className="mt-3">
          {kinds.length > 1 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {kinds.map((k) => (
                <Button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  aria-pressed={kind === k}
                  className={
                    kind === k
                      ? "h-7 rounded-md bg-[#17191C] px-2.5 text-[11.5px] font-bold text-white hover:bg-[#0E1012]"
                      : "h-7 rounded-md border border-[#E4E9EF] bg-white px-2.5 text-[11.5px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
                  }
                >
                  {KIND_LABEL[k]}
                </Button>
              ))}
            </div>
          ) : null}

          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder={`Add to ${label.toLowerCase()}…`}
            className="text-[13px]"
          />
          {error ? <FormError>{error}</FormError> : null}
          <Button
            type="button"
            disabled={add.isPending || !body.trim()}
            onClick={() => add.mutate()}
            className="mt-2 h-8 rounded-md bg-[#17191C] px-3 text-[12px] font-bold text-white hover:bg-[#0E1012]"
          >
            {add.isPending ? "Saving…" : "Add"}
          </Button>
        </div>
      ) : null}

      {sessionStatus === "loading" || query.isPending ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ) : query.isError ? (
        <div className="mt-4">
          <PanelAlert>
            <span className="flex flex-wrap items-center gap-2">
              <span>{toMessage(query.error)}</span>
              <Button
                type="button"
                variant="link"
                onClick={() => query.refetch()}
                className="h-auto p-0 text-[12px] font-bold text-[#B03A3A] underline"
              >
                Try again
              </Button>
            </span>
          </PanelAlert>
        </div>
      ) : items.length === 0 ? (
        <p className={`mt-4 text-[12.5px] ${TONE.muted}`}>
          {canWrite
            ? `Nothing written here yet. ${label} are added to rather than written over, so the whole history stays.`
            : "Nothing written here yet."}
        </p>
      ) : (
        <>
          <ul className="mt-3">
            {items.map((comment) => (
              <CommentRow
                key={comment.id}
                comment={comment}
                // Only the author, and the server checks again. A management
                // note also needs the role the author holds *now*, which is
                // why an ineligible edit is refused there rather than hidden
                // here — the refusal explains itself.
                canEdit={!!user && comment.authorUserId === user.id}
                onSaved={invalidate}
                accessToken={accessToken!}
              />
            ))}
          </ul>
          {/* A capped list looks exactly like a short one unless it says so. */}
          {query.data?.truncated ? (
            <p className={`mt-3 text-[11.5px] ${TONE.muted}`}>
              Showing the newest {query.data.limit}. Older entries are not listed here yet.
            </p>
          ) : null}
        </>
      )}
    </section>
  )
}
