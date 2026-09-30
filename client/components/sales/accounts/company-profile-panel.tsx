"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { RiPencilLine } from "@remixicon/react"

import { getAccountProfile } from "@/lib/api/sales/accounts"
import { salesKeys } from "@/lib/api/sales/keys"
import { answerLine } from "@/lib/account-profile"
import { useSession } from "@/lib/auth/session-context"
import { TONE } from "@/components/dashboard/record-kit"
import { Panel, PanelError, PanelHeading, PanelSkeleton } from "@/components/sales/shared/panel"
import { ProfileEditDialog } from "@/components/sales/accounts/profile-edit-dialog"
import { Button } from "@/components/ui/button"

const onDay = (iso: string) => new Date(iso).toLocaleDateString()

function Row({ question, line, note }: { question: string; line: string | null; note: string | null }) {
  return (
    <div className="grid gap-x-6 gap-y-0.5 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <dt className={`text-[12.5px] ${TONE.muted}`}>{question}</dt>
      <dd className="text-[13px] font-semibold [overflow-wrap:anywhere]">
        {line ?? <span className={`font-normal ${TONE.muted}`}>Not recorded</span>}
        {note ? <span className={`block text-[11.5px] font-normal ${TONE.muted}`}>{note}</span> : null}
      </dd>
    </div>
  )
}

/**
 * The Company profile on an account's About tab: what the team knows about the
 * company, one question per row. An unanswered question says "Not recorded"
 * and the count says how many are answered, so a blank is never mistaken for a
 * "No". Only the people who can edit the account see the Edit button.
 */
export function CompanyProfilePanel({ accountId }: { accountId: string }) {
  const { accessToken } = useSession()
  const [editing, setEditing] = useState(false)
  const query = useQuery({
    queryKey: salesKeys.accountProfile(accountId),
    queryFn: () => getAccountProfile(accessToken!, accountId),
    enabled: !!accessToken,
  })

  if (query.isPending) return <PanelSkeleton />
  if (query.isError) return <PanelError onRetry={() => query.refetch()} />
  const profile = query.data

  return (
    <Panel>
      <PanelHeading
        title="Company profile"
        action={
          profile.canManage ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(true)}
              className="h-8 gap-1.5 px-2.5 text-[12px] font-bold"
            >
              <RiPencilLine className="size-3.5" aria-hidden />
              Edit profile
            </Button>
          ) : null
        }
      />
      <p className={`-mt-1 mb-3 text-[12.5px] ${TONE.muted}`}>
        {profile.answered} of {profile.total} questions answered
      </p>

      {profile.groups.map((group) => (
        <section key={group.key} className="mt-4 first:mt-0">
          <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>{group.title}</h3>
          <dl className="mt-1 divide-y divide-[#E4E9EF]">
            {group.questions.map((q) => (
              <Row
                key={q.key}
                question={q.text}
                line={answerLine(q)}
                note={q.answeredAt ? `${q.answeredByName ?? "Someone"} · ${onDay(q.answeredAt)}` : null}
              />
            ))}
          </dl>
        </section>
      ))}

      {profile.custom.length > 0 ? (
        <section className="mt-4">
          <h3 className={`text-[11.5px] font-bold tracking-wide uppercase ${TONE.muted}`}>Other questions</h3>
          <dl className="mt-1 divide-y divide-[#E4E9EF]">
            {profile.custom.map((c) => (
              <Row
                key={c.id}
                question={c.question}
                line={c.answer}
                note={`${c.answeredByName ?? "Someone"} · ${onDay(c.answeredAt)}`}
              />
            ))}
          </dl>
        </section>
      ) : null}

      {profile.canManage ? (
        <ProfileEditDialog accountId={accountId} profile={profile} open={editing} onOpenChange={setEditing} />
      ) : null}
    </Panel>
  )
}
