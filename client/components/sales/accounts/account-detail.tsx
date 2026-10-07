"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  RiAlertLine,
  RiCalendar2Line,
  RiContactsLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiFlashlightLine,
  RiFolder3Line,
  RiGridLine,
  RiGlobalLine,
  RiGroupLine,
  RiHistoryLine,
  RiInformationLine,
  RiMapPinLine,
  RiMessage2Line,
  RiTaskLine,
} from "@remixicon/react"

import { getSalesAccount } from "@/lib/api/sales/accounts"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import { Tag } from "@/components/dashboard/tag"
import { ACCOUNT_STATUS_LABEL, ACCOUNT_STATUS_TONE } from "@/components/sales/shared/sales-shared"
import { MeetingsPanel, TasksPanel } from "@/components/sales/shared/plan-panels"
import { Button } from "@/components/ui/button"
import { AccountHeatmapPanel } from "@/components/sales/accounts/account-heatmap-panel"
import { AccountEditDialog } from "@/components/sales/accounts/account-edit-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { RecordTabs } from "@/components/sales/shared/record-tabs"
import { CommentPanel } from "@/components/sales/shared/comment-panel"
import { ContactsPanel } from "@/components/sales/accounts/contacts-panel"
import { AccountAboutPanel } from "@/components/sales/accounts/account-about-panel"
import { VisitingCardPanel } from "@/components/sales/accounts/visiting-card-panel"
import { AccountOpportunitiesPanel } from "@/components/sales/accounts/account-opportunities-panel"
import { AccountProjectsPanel } from "@/components/sales/accounts/account-projects-panel"
import { AccountHistoryPanel } from "@/components/sales/accounts/account-history-panel"
import { AccountTimelinePanel } from "@/components/sales/accounts/account-timeline-panel"
import { useSalesPermissions } from "@/components/sales/shared/use-sales-permissions"

/**
 * The account page: a header card, then one tab per area (spec 2026-09-28
 * §1.1). The open tab lives in `?tab=`, so a link to this account opens the
 * tab the sender meant and a link with no `?tab` opens the first one.
 */
export function AccountDetail({ accountId, initialTab }: { accountId: string; initialTab: string | null }) {
  const { accessToken, user, status: sessionStatus } = useSession()
  const isAuthed = sessionStatus === "authenticated" && !!accessToken

  const [editOpen, setEditOpen] = useState(false)
  // Opening from the flag rather than the Edit button changes the dialog's
  // title and leads with the owner, because the reason is already known.
  const [editFocusOwner, setEditFocusOwner] = useState(false)

  // Management notes are admin-only to write. The server refuses either way;
  // hiding the option keeps a control that cannot act off the screen.
  const isSalesAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")
  // A Sales Admin can switch editing off for Sales Users. For looks only: the
  // server refuses the edit either way.
  const { can } = useSalesPermissions()

  const accountQuery = useQuery({
    queryKey: ["sales", "accounts", accountId],
    queryFn: () => getSalesAccount(accessToken!, accountId),
    enabled: isAuthed,
  })

  function openEdit(focusOwner: boolean) {
    setEditFocusOwner(focusOwner)
    setEditOpen(true)
  }

  return (
    <>
      <div className="pt-7 pb-4">
        {/* All Accounts, not My Accounts: the latter can genuinely not list an
            account this viewer only has read access to, so it is not a safe
            "back" destination for every visitor of this page. */}
        {/* #5F6B7C, not #7A8698: the latter is 3.7:1 on white and is recorded
            in the UI standard as failing AA at this size. */}
        <Link href="/sales/accounts" className="text-[12.5px] font-semibold text-[#5F6B7C] hover:underline">
          ← All Accounts
        </Link>
      </div>

      {sessionStatus === "loading" || accountQuery.isPending ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2.5 h-3.5 w-64" />
        </div>
      ) : accountQuery.isError ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-8 text-center">
          <span className="mx-auto mb-2.5 flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          {/* Server refusal, verbatim — "That Sales Account does not exist,
              or is not yours" already says the right thing. */}
          <p className="text-[13px] font-semibold text-[#B03A3A]">
            {accountQuery.error instanceof ApiError
              ? accountQuery.error.message
              : "This account could not be loaded."}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5.5 py-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-heading text-[21px] font-bold tracking-tight">{accountQuery.data.name}</h1>
            <Tag
              label={ACCOUNT_STATUS_LABEL[accountQuery.data.status]}
              tone={ACCOUNT_STATUS_TONE[accountQuery.data.status]}
            />
            {!accountQuery.data.canManage ? <Tag label="View only" tone="neutral" /> : null}
            {accountQuery.data.canManage && can("account.edit") ? (
              <Button
                type="button"
                onClick={() => openEdit(false)}
                className="ml-auto h-8 rounded-md border border-[#E4E9EF] bg-white px-3 text-[12px] font-bold text-[#17191C] hover:bg-[#F7F9FB]"
              >
                Edit
              </Button>
            ) : null}
          </div>

          {/* The reason lives beside the status it explains. Without it a
              Do Not Contact badge is a decision with no record of why. */}
          {accountQuery.data.statusReason ? (
            <p className="mt-2 text-[12.5px] text-[#5F6B7C]">{accountQuery.data.statusReason}</p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-[#5F6B7C]">
            <span>Owner: {accountQuery.data.ownerName}</span>
            {accountQuery.data.assignees.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <RiGroupLine className="size-3.5 text-[#8A94A2]" aria-hidden />
                {accountQuery.data.assignees.map((a) => a.fullName).join(", ")}
              </span>
            ) : null}
            {accountQuery.data.industry ? <span>{accountQuery.data.industry}</span> : null}
          </div>

          {accountQuery.data.website || accountQuery.data.address ? (
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-[#6B7789]">
              {accountQuery.data.website ? (
                <span className="inline-flex items-center gap-1">
                  <RiGlobalLine className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
                  {accountQuery.data.website}
                </span>
              ) : null}
              {accountQuery.data.address ? (
                <span className="inline-flex items-center gap-1">
                  <RiMapPinLine className="size-3.5 shrink-0 text-[#8A94A2]" aria-hidden />
                  {accountQuery.data.address}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Louder than the read-only note, and shown to everyone: an
              account whose owner cannot work it is a gap in coverage, not a
              fact about the viewer's permissions. */}
          {!accountQuery.data.ownerActive ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#F5E0BE] bg-[#FDF8EE] px-3 py-2 text-[12px] leading-relaxed text-[#8A5E0C]">
              <RiAlertLine className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                {accountQuery.data.ownerName} can no longer work this account — their Techno Sales
                Hub access has been removed or they have left. It needs a new owner.
                {/* The flag used to state a problem the interface could not
                    solve. It now leads to the one action that clears it. */}
                {accountQuery.data.canChangeOwner && can("account.edit") ? (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => openEdit(true)}
                    className="ml-1.5 h-auto p-0 text-[12px] font-bold text-[#8A5E0C] underline"
                  >
                    Choose a new owner
                  </Button>
                ) : null}
              </span>
            </p>
          ) : null}

          {!accountQuery.data.canManage ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#E4E9EF] bg-[#F7F9FB] px-3 py-2 text-[12px] leading-relaxed text-[#5F6B7C]">
              <RiEyeLine className="mt-px size-3.5 shrink-0" aria-hidden />
              You can see this account because it is shared in All Accounts, but only its owner,
              its collaborators, or a Sales Admin can add contacts or log activity on it.
            </p>
          ) : null}
        </div>
      )}

      {accountQuery.data ? (
        <RecordTabs
          initialTab={initialTab}
          tabs={[
            { value: "about", icon: RiInformationLine, label: "About", content: <AccountAboutPanel account={accountQuery.data} /> },
            {
              value: "remarks",
              icon: RiMessage2Line,
              label: "Remarks",
              // "Remarks" here and "Comments" on an Opportunity, from one
              // component. That is the business's own vocabulary and the two
              // labels must not be made consistent with each other.
              content: (
                <CommentPanel
                  entity="SALES_ACCOUNT"
                  entityId={accountQuery.data.id}
                  label="Remarks"
                  // Customer feedback is offered on an Opportunity only: it is
                  // always about a specific Opportunity.
                  kinds={isSalesAdmin ? ["GENERAL", "MANAGEMENT_NOTE"] : ["GENERAL"]}
                  canWrite={accountQuery.data.canManage}
                />
              ),
            },
            {
              value: "contacts",
              icon: RiContactsLine,
              label: "Contacts",
              // The visiting card is the contact details of the person the team
              // met, so it sits with the contacts. It belongs to the account, not
              // to one contact person: there is no link between the two.
              content: (
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
                  <ContactsPanel accountId={accountId} canManage={accountQuery.data.canManage} />
                  <VisitingCardPanel account={accountQuery.data} />
                </div>
              ),
            },
            { value: "opportunities", icon: RiFlashlightLine, label: "Opportunities", content: <AccountOpportunitiesPanel account={accountQuery.data} /> },
            { value: "projects", icon: RiFolder3Line, label: "Projects", content: <AccountProjectsPanel accountId={accountId} /> },
            { value: "heatmap", icon: RiGridLine, label: "Heatmap", content: <AccountHeatmapPanel accountId={accountId} /> },
            {
              value: "timeline",
              icon: RiHistoryLine,
              label: "Timeline History",
              content: (
                <div className="grid gap-4">
                  <AccountTimelinePanel
                    accountId={accountId}
                    canManage={accountQuery.data.canManage}
                    canLog={accountQuery.data.canLogActivity}
                  />
                  <AccountHistoryPanel accountId={accountId} />
                </div>
              ),
            },
            { value: "meetings", icon: RiCalendar2Line, label: "Meetings", content: <MeetingsPanel accountId={accountId} canManage={accountQuery.data.canManage} /> },
            { value: "tasks", icon: RiTaskLine, label: "Tasks", content: <TasksPanel accountId={accountId} canManage={accountQuery.data.canManage} /> },
          ]}
        />
      ) : null}

      {accountQuery.data && accountQuery.data.canManage ? (
        <AccountEditDialog
          account={accountQuery.data}
          open={editOpen}
          onOpenChange={setEditOpen}
          focusOwner={editFocusOwner}
        />
      ) : null}
    </>
  )
}