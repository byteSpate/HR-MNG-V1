"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { updateAccountProfile } from "@/lib/api/sales/accounts"
import { salesKeys } from "@/lib/api/sales/keys"
import { diffProfile, draftOf, draftProblem, type ProfileDraft } from "@/lib/account-profile"
import { useSession } from "@/lib/auth/session-context"
import type { AccountProfile, ProfileQuestionView, UpdateAccountProfileBody } from "@/lib/api/types"
import { DialogActions, FormError, TONE, toMessage } from "@/components/dashboard/record-kit"
import { CustomQnaEditor } from "@/components/sales/accounts/custom-qna-editor"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Value = { answer: string; detail: string }

const YES_NO_CHOICES = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
  { value: "", label: "Not answered" },
] as const

/** One question and the control that fits its kind of answer. */
function QuestionField({
  q,
  value,
  onChange,
}: {
  q: ProfileQuestionView
  value: Value
  onChange: (next: Value) => void
}) {
  const id = `profile-${q.key}`
  return (
    <div className="space-y-1.5">
      <div id={`${id}-label`} className="text-[13px] font-semibold">
        {q.text}
      </div>

      {q.type === "YES_NO" ? (
        <>
          <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
            {YES_NO_CHOICES.map((choice) => {
              const selected = value.answer === choice.value
              return (
                <button
                  key={choice.value || "none"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange({ answer: choice.value, detail: choice.value === "YES" ? value.detail : "" })}
                  className={cn(
                    "h-8 rounded-md border px-3 text-[12.5px] font-semibold transition-colors motion-reduce:transition-none",
                    selected
                      ? "border-[#17191C] bg-[#17191C] text-white"
                      : "border-[#E4E9EF] bg-white hover:border-[#8A94A2]",
                  )}
                >
                  {choice.label}
                </button>
              )
            })}
          </div>
          {value.answer === "YES" ? (
            <Input
              aria-label={q.detailLabel ?? "Details"}
              placeholder={q.detailLabel ?? "Details"}
              value={value.detail}
              maxLength={300}
              onChange={(e) => onChange({ ...value, detail: e.target.value })}
            />
          ) : null}
        </>
      ) : q.type === "CHOICE" ? (
        <select
          aria-labelledby={`${id}-label`}
          value={value.answer}
          onChange={(e) => onChange({ answer: e.target.value, detail: "" })}
          className="h-9 w-full rounded-md border border-[#E4E9EF] bg-white px-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#17191C]/20"
        >
          <option value="">Not answered</option>
          {(q.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : q.type === "NUMBER" ? (
        <Input
          aria-labelledby={`${id}-label`}
          inputMode="numeric"
          value={value.answer}
          maxLength={7}
          onChange={(e) => onChange({ answer: e.target.value.replace(/\D/g, ""), detail: "" })}
        />
      ) : (
        <Input
          aria-labelledby={`${id}-label`}
          value={value.answer}
          maxLength={300}
          onChange={(e) => onChange({ answer: e.target.value, detail: "" })}
        />
      )}
    </div>
  )
}

function ProfileForm({
  profile,
  accountId,
  onDone,
}: {
  profile: AccountProfile
  accountId: string
  onDone: () => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ProfileDraft>(() => draftOf(profile))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (body: UpdateAccountProfileBody) => updateAccountProfile(accessToken!, accountId, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(salesKeys.accountProfile(accountId), updated)
      queryClient.invalidateQueries({ queryKey: salesKeys.accountHistory(accountId) })
      onDone()
    },
    // Verbatim: the server names the question and what to do.
    onError: (err) => setError(toMessage(err)),
  })

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null)
    const problem = draftProblem(draft)
    if (problem) {
      setError(problem)
      return
    }
    const body = diffProfile(profile, draft)
    if (!body) {
      setError("Nothing was changed.")
      return
    }
    save.mutate(body)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* The dialog itself stops at 85svh and scrolls past that. This list is capped
          at that height minus the title, the footer, the error line and the
          padding (about 14.6rem, so 16rem to be safe). Capped at a plain 60vh it
          was taller than the room left, and a phone showed two scrollbars, one
          for the dialog and one for this list. */}
      <div className="max-h-[calc(85svh-16rem)] min-h-40 space-y-6 overflow-y-auto pr-1">
        {profile.groups.map((group) => (
          <section key={group.key} className="space-y-4">
            <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>{group.title}</h3>
            {group.questions.map((q) => (
              <QuestionField
                key={q.key}
                q={q}
                value={draft.answers[q.key] ?? { answer: "", detail: "" }}
                onChange={(next) => setDraft((d) => ({ ...d, answers: { ...d.answers, [q.key]: next } }))}
              />
            ))}
          </section>
        ))}

        <section className="space-y-3">
          <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Your own questions</h3>
          <p className={`text-[12px] ${TONE.muted}`}>
            Add a question and its answer about this company. To remove one, use Remove and then save.
          </p>
          <CustomQnaEditor
            rows={draft.custom}
            onChange={(custom) => setDraft((d) => ({ ...d, custom }))}
            idPrefix="profile-own"
            disabled={save.isPending}
          />
        </section>
      </div>

      {error ? <FormError>{error}</FormError> : null}

      <DialogFooter>
        <DialogActions
          pending={save.isPending}
          submitLabel="Save changes"
          disabled={false}
          onCancel={onDone}
          onSubmit={() => handleSubmit()}
        />
      </DialogFooter>
    </form>
  )
}

/**
 * Editing the whole Company profile: the ready-made questions and the
 * account's own. Mounted only while open and keyed by the account, so every
 * box starts from what is stored and a cancelled edit leaves no draft behind.
 * Only what changed is sent.
 */
export function ProfileEditDialog({
  accountId,
  profile,
  open,
  onOpenChange,
}: {
  accountId: string
  profile: AccountProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit company profile</DialogTitle>
        </DialogHeader>
        {open ? (
          <ProfileForm key={accountId} profile={profile} accountId={accountId} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
