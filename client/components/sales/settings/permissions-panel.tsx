"use client"

/**
 * "Who can do what": the Permission switches (CONTEXT.md). A Sales Admin turns
 * each Sales Hub action on or off for all Sales Users. Everyone in the hub can
 * read it. A Sales User sees the switches but cannot change them.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiErrorWarningLine, RiRefreshLine } from "@remixicon/react"

import { listSalesPermissionHistory, listSalesPermissions, saveSalesPermissions } from "@/lib/api/sales/permissions"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import { CheckboxField, PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { groupPermissions, lastChangeOf, pendingChanges, type PermissionDraft } from "./permission-draft"

const PRIMARY = "h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">{children}</section>
}

export function PermissionsPanel() {
  const { accessToken, status, user } = useSession()
  const queryClient = useQueryClient()
  const canChange = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")
  const [draft, setDraft] = useState<PermissionDraft>({})
  const [saved, setSaved] = useState(false)

  const query = useQuery({
    queryKey: salesKeys.permissions(),
    queryFn: () => listSalesPermissions(accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  })

  const save = useMutation({
    mutationFn: (changes: ReturnType<typeof pendingChanges>) => saveSalesPermissions(accessToken!, { changes }),
    onSuccess: (next) => {
      queryClient.setQueryData(salesKeys.permissions(), next)
      queryClient.invalidateQueries({ queryKey: salesKeys.myPermissions() })
      // A sibling key, not a child of the one above: without this the "Recent
      // changes" list stays stale until the page is reloaded.
      queryClient.invalidateQueries({ queryKey: salesKeys.permissionHistory() })
      setDraft({})
      setSaved(true)
    },
  })

  const history = useQuery({
    queryKey: salesKeys.permissionHistory(),
    queryFn: () => listSalesPermissionHistory(accessToken!),
    enabled: status === "authenticated" && !!accessToken,
  })

  if (query.isPending) {
    return (
      <Panel>
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-3">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      </Panel>
    )
  }

  // Only when there is nothing to show. A failed refresh keeps what is on screen.
  if (!query.data) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          <div className="text-[13.5px] font-bold">The permission switches could not be loaded</div>
          <p className={`text-[12.5px] ${TONE.muted}`}>{toMessage(query.error)}</p>
          <Button onClick={() => query.refetch()} className={PRIMARY}>
            <RiRefreshLine className="size-4" aria-hidden />
            Try again
          </Button>
        </div>
      </Panel>
    )
  }

  const rows = query.data.items
  const changes = pendingChanges(rows, draft)
  const groups = groupPermissions(rows)

  return (
    <div className="grid gap-3">
      {saved ? (
        <PanelNotice onDismiss={() => setSaved(false)}>
          Saved. It can take up to 30 seconds to reach everyone.
        </PanelNotice>
      ) : null}
      {save.isError ? <PanelAlert>{toMessage(save.error)}</PanelAlert> : null}
      <Panel>
        <h2 className="text-[14px] font-bold">Who can do what</h2>
        <p className={`mt-1 text-[12.5px] ${TONE.muted}`}>
          Tick what Sales Users can do. If you untick something, no Sales User can do it, even if it is their own
          record. Sales Admins can always do everything.{" "}
          {canChange ? "You can change these." : "Only a Sales Admin can change these."}
        </p>

        <div className="mt-4 grid gap-5">
          {groups.map(({ group, rows: groupRows }) => {
            const last = lastChangeOf(groupRows)
            return (
              <div key={group}>
                <div className="text-[12.5px] font-bold">{group}</div>
                <div className="mt-1 grid">
                  {groupRows.map((row) => (
                    <CheckboxField
                      key={row.key}
                      label={row.label}
                      checked={draft[row.key] ?? row.enabled}
                      disabled={!canChange || save.isPending}
                      onChange={(next) => {
                        setSaved(false)
                        setDraft((d) => ({ ...d, [row.key]: next }))
                      }}
                    />
                  ))}
                </div>
                {last ? (
                  <p className={`mt-1 text-[11.5px] ${TONE.muted}`}>
                    Last changed {last.changedByName ? `by ${last.changedByName} ` : ""}on{" "}
                    {new Date(last.changedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>

        {canChange ? (
          <div className="mt-5 flex items-center gap-3">
            <Button
              disabled={changes.length === 0 || save.isPending}
              onClick={() => save.mutate(changes)}
              className={PRIMARY}
            >
              {save.isPending ? "Saving" : "Save changes"}
            </Button>
            {changes.length > 0 ? (
              <span className={`text-[12px] ${TONE.muted}`}>
                {changes.length} {changes.length === 1 ? "change" : "changes"} not saved yet
              </span>
            ) : null}
          </div>
        ) : null}

        <h3 className="mt-6 text-[12.5px] font-bold">Recent changes</h3>
        {history.isPending ? (
          <Skeleton className="mt-2 h-5 w-full" />
        ) : history.isError ? (
          <p className={`mt-2 text-[12px] ${TONE.muted}`}>The list of changes could not be loaded. {toMessage(history.error)}</p>
        ) : history.data.items.length === 0 ? (
          <p className={`mt-2 text-[12px] ${TONE.muted}`}>Nobody has changed these yet.</p>
        ) : (
          <ul className="mt-2 grid gap-1" data-testid="permission-history">
            {history.data.items.map((item) => (
              <li key={`${item.key}-${item.changedAt}`} className={`text-[12px] ${TONE.muted}`}>
                {new Date(item.changedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                {": "}
                {item.changedByName ?? "A Sales Admin"} turned &quot;{item.label}&quot; {item.enabled ? "on" : "off"}.
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
