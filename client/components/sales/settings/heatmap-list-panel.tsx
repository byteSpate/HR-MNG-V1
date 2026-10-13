"use client"

/**
 * "Heatmap list" (owner, 2026-10-13): the groups, products and parts on every
 * account's Heatmap tab. Sales Admins and Super Admins add, rename, move, hide
 * and delete them. Something an account uses cannot be deleted, only hidden;
 * the server checks that again, so a refusal is shown word for word.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RiErrorWarningLine, RiRefreshLine } from "@remixicon/react"

import {
  addHeatmapListRow,
  deleteHeatmapListRow,
  editHeatmapListRow,
  getHeatmapList,
  moveHeatmapListRow,
} from "@/lib/api/sales/heatmap"
import { salesKeys } from "@/lib/api/sales/keys"
import { useSession } from "@/lib/auth/session-context"
import type { HeatmapList, HeatmapListLevel } from "@/lib/api/types"
import { deleteWarning, usedByText } from "@/lib/heatmap"
import { ConfirmDeleteDialog, PanelAlert, PanelNotice, TONE, toMessage } from "@/components/dashboard/record-kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const PRIMARY = "h-auto rounded-md bg-[#17191C] px-3.5 py-2 text-[12.5px] font-bold text-white hover:bg-[#0E1012]"
const QUIET =
  "h-auto min-h-8 rounded-md px-2.5 py-1 text-[12px] font-bold text-[#5F6B7C] hover:bg-[#F1F4F8] hover:text-[#1C2733] disabled:opacity-40"

/** One line in the list, whatever its level. */
interface Row {
  id: string
  title: string
  note?: string | null
  hidden: boolean
  usedBy: number
}

type Editing = { level: HeatmapListLevel; id: string } | null
type Removing = { level: HeatmapListLevel; row: Row } | null

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-md border border-[#E4E9EF] bg-white px-4 py-4 sm:px-5.5 sm:py-5">{children}</section>
}

/** Every action returns the whole list. Each one also tells open account tabs to read the list again. */
function useListActions() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const done = (next: HeatmapList, message: string | null = null) => {
    queryClient.setQueryData(salesKeys.heatmapList(), next)
    queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "sales" && q.queryKey[1] === "accounts" && q.queryKey[3] === "heatmap",
    })
    setNotice(message)
  }
  const start = () => {
    setError(null)
    setNotice(null)
  }
  const fail = (err: unknown) => setError(toMessage(err))

  const add = useMutation({
    mutationFn: (v: { level: HeatmapListLevel; parentId: string | null; title: string; note: string | null }) =>
      addHeatmapListRow(accessToken!, v.level, v.parentId, { title: v.title, note: v.note }),
    onMutate: start,
    onSuccess: (next) => done(next, "Added."),
    onError: fail,
  })
  const edit = useMutation({
    mutationFn: (v: { level: HeatmapListLevel; id: string; body: { title?: string; note?: string | null; hidden?: boolean } }) =>
      editHeatmapListRow(accessToken!, v.level, v.id, v.body),
    onMutate: start,
    onSuccess: (next) => done(next),
    onError: fail,
  })
  const move = useMutation({
    mutationFn: (v: { level: HeatmapListLevel; id: string; direction: "UP" | "DOWN" }) =>
      moveHeatmapListRow(accessToken!, v.level, v.id, v.direction),
    onMutate: start,
    onSuccess: (next) => done(next),
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (v: { level: HeatmapListLevel; id: string }) => deleteHeatmapListRow(accessToken!, v.level, v.id),
    onMutate: start,
    onSuccess: (next) => done(next, "Deleted."),
    onError: fail,
  })

  return { add, edit, move, remove, error, notice, clear: () => setNotice(null), clearError: () => setError(null) }
}

type Actions = ReturnType<typeof useListActions>

export function HeatmapListPanel() {
  const { accessToken, status, user } = useSession()
  const isAdmin = !!user && (user.role === "SUPER_ADMIN" || user.salesRole === "SALES_ADMIN")
  const actions = useListActions()
  const [editing, setEditing] = useState<Editing>(null)
  const [removing, setRemoving] = useState<Removing>(null)
  const [openProducts, setOpenProducts] = useState<Set<string>>(new Set())

  const query = useQuery({
    queryKey: salesKeys.heatmapList(),
    queryFn: () => getHeatmapList(accessToken!),
    enabled: status === "authenticated" && !!accessToken && isAdmin,
  })

  if (!isAdmin) return null

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

  if (!query.data) {
    return (
      <Panel>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex size-9 items-center justify-center rounded-md bg-[#FDF6F6] text-[#B03A3A]">
            <RiErrorWarningLine className="size-5" aria-hidden />
          </span>
          <div className="text-[13.5px] font-bold">The heatmap list could not be loaded</div>
          <p className={`text-[12.5px] ${TONE.muted}`}>{toMessage(query.error)}</p>
          <Button onClick={() => query.refetch()} className={PRIMARY}>
            <RiRefreshLine className="size-4" aria-hidden />
            Retry
          </Button>
        </div>
      </Panel>
    )
  }

  const groups = query.data.groups
  const toggleProduct = (id: string) =>
    setOpenProducts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const lineProps = { actions, editing, setEditing, onRemove: (level: HeatmapListLevel, row: Row) => setRemoving({ level, row }) }

  return (
    <Panel>
      <h2 className="text-[13.5px] font-bold">Heatmap list</h2>
      <p className={`mt-1 mb-3 text-[12.5px] leading-relaxed ${TONE.muted}`}>
        The groups, products and parts on every account&apos;s Heatmap tab. Something an account uses can be hidden, not
        deleted. Who can change this: Sales Admins.
      </p>

      <div className="grid gap-3">
        {actions.error ? <PanelAlert onDismiss={actions.clearError}>{actions.error}</PanelAlert> : null}
        {actions.notice ? <PanelNotice onDismiss={actions.clear}>{actions.notice}</PanelNotice> : null}

        {groups.length === 0 ? <p className={`text-[12.5px] ${TONE.muted}`}>The list is empty. Add a group to start.</p> : null}

        {groups.map((group, gi) => (
          <div key={group.id} className="rounded-md border border-[#E4E9EF] p-3">
            <ListLine level="groups" row={group} first={gi === 0} last={gi === groups.length - 1} strong {...lineProps} />
            <ul className="mt-2 grid gap-2 border-l-2 border-[#EEF1F5] pl-3">
              {group.products.map((product, pi) => {
                const open = openProducts.has(product.id)
                return (
                  <li key={product.id} className="grid gap-1.5">
                    <ListLine
                      level="products"
                      row={product}
                      first={pi === 0}
                      last={pi === group.products.length - 1}
                      extra={
                        <Button type="button" variant="ghost" className={QUIET} aria-expanded={open} onClick={() => toggleProduct(product.id)}>
                          {open ? "Hide parts" : `Show parts (${product.parts.length})`}
                        </Button>
                      }
                      {...lineProps}
                    />
                    {open ? (
                      <ul className="grid gap-1.5 border-l-2 border-[#EEF1F5] pl-3">
                        {product.parts.map((part, ri) => (
                          <li key={part.id}>
                            <ListLine level="parts" row={part} first={ri === 0} last={ri === product.parts.length - 1} {...lineProps} />
                          </li>
                        ))}
                        <li>
                          <AddForm level="parts" parentId={product.id} actions={actions} />
                        </li>
                      </ul>
                    ) : null}
                  </li>
                )
              })}
              <li>
                <AddForm level="products" parentId={group.id} actions={actions} />
              </li>
            </ul>
          </div>
        ))}

        <AddForm level="groups" parentId={null} actions={actions} />
      </div>

      <ConfirmDeleteDialog
        open={!!removing}
        what={removing ? removing.row.title : "this"}
        detail={removing ? deleteWarning(removing.level) : null}
        pending={actions.remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          actions.remove.mutate({ level: removing.level, id: removing.row.id }, { onSettled: () => setRemoving(null) })
        }
      />
    </Panel>
  )
}

function ListLine({
  level,
  row,
  first,
  last,
  strong,
  extra,
  actions,
  editing,
  setEditing,
  onRemove,
}: {
  level: HeatmapListLevel
  row: Row
  first: boolean
  last: boolean
  strong?: boolean
  extra?: React.ReactNode
  actions: Actions
  editing: Editing
  setEditing: (e: Editing) => void
  onRemove: (level: HeatmapListLevel, row: Row) => void
}) {
  const isEditing = editing?.level === level && editing.id === row.id
  const busy = actions.edit.isPending || actions.move.isPending || actions.remove.isPending
  const used = usedByText(row.usedBy)

  if (isEditing) return <NameEditor level={level} row={row} actions={actions} onDone={() => setEditing(null)} />

  return (
    <div className={cn("flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1", row.hidden && "opacity-60")}>
      <div className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("[overflow-wrap:anywhere]", strong ? "text-[13.5px] font-bold" : "text-[12.5px] font-semibold")}>
            {row.title}
          </span>
          {row.hidden ? (
            <span className="rounded bg-[#F1F4F8] px-1.5 py-0.5 text-[11px] font-bold text-[#5F6B7C]">Hidden</span>
          ) : null}
        </span>
        {row.note ? <span className={`text-[11.5px] leading-snug [overflow-wrap:anywhere] ${TONE.muted}`}>{row.note}</span> : null}
        {used ? <span className={`text-[11.5px] ${TONE.muted}`}>{used}</span> : null}
      </div>
      <div className="flex flex-wrap gap-1">
        {extra}
        <Button type="button" variant="ghost" className={QUIET} disabled={busy} onClick={() => setEditing({ level, id: row.id })}>
          {level === "parts" ? "Edit" : "Rename"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={QUIET}
          disabled={busy || first}
          onClick={() => actions.move.mutate({ level, id: row.id, direction: "UP" })}
        >
          Move up
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={QUIET}
          disabled={busy || last}
          onClick={() => actions.move.mutate({ level, id: row.id, direction: "DOWN" })}
        >
          Move down
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={QUIET}
          disabled={busy}
          onClick={() => actions.edit.mutate({ level, id: row.id, body: { hidden: !row.hidden } })}
        >
          {row.hidden ? "Show" : "Hide"}
        </Button>
        {row.usedBy === 0 ? (
          <Button
            type="button"
            variant="ghost"
            className={cn(QUIET, "text-[#B03A3A] hover:bg-[#FDF6F6] hover:text-[#8F2F2F]")}
            disabled={busy}
            onClick={() => onRemove(level, row)}
          >
            Delete
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function NameEditor({ level, row, actions, onDone }: { level: HeatmapListLevel; row: Row; actions: Actions; onDone: () => void }) {
  const [title, setTitle] = useState(row.title)
  const [note, setNote] = useState(row.note ?? "")
  const save = () => {
    const body = level === "parts" ? { title: title.trim(), note: note.trim() } : { title: title.trim() }
    actions.edit.mutate({ level, id: row.id, body }, { onSuccess: onDone })
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone()
      }}
    >
      <Input
        autoFocus
        aria-label="Name"
        value={title}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
        className="min-w-0 flex-1 basis-48 text-[12.5px]"
      />
      {level === "parts" ? (
        <Input
          aria-label="Short line"
          placeholder="Short line, like: Up to 3 Gbps"
          value={note}
          maxLength={160}
          onChange={(e) => setNote(e.target.value)}
          className="min-w-0 flex-1 basis-60 text-[12.5px]"
        />
      ) : null}
      <Button type="submit" disabled={actions.edit.isPending} className={PRIMARY}>
        Save
      </Button>
      <Button type="button" variant="ghost" className={QUIET} onClick={onDone}>
        Cancel
      </Button>
    </form>
  )
}

const ADD_LABEL: Record<HeatmapListLevel, string> = { groups: "Add group", products: "Add product", parts: "Add part" }

function AddForm({ level, parentId, actions }: { level: HeatmapListLevel; parentId: string | null; actions: Actions }) {
  const [title, setTitle] = useState("")
  const [note, setNote] = useState("")

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        actions.add.mutate(
          { level, parentId, title: title.trim(), note: level === "parts" ? note.trim() || null : null },
          {
            onSuccess: () => {
              setTitle("")
              setNote("")
            },
          }
        )
      }}
    >
      <Input
        aria-label={`${ADD_LABEL[level]}: name`}
        placeholder={level === "groups" ? "New group name" : level === "products" ? "New product name" : "New part name"}
        value={title}
        maxLength={80}
        onChange={(e) => setTitle(e.target.value)}
        className="min-w-0 flex-1 basis-48 text-[12.5px]"
      />
      {level === "parts" ? (
        <Input
          aria-label="Short line"
          placeholder="Short line (you can leave it empty)"
          value={note}
          maxLength={160}
          onChange={(e) => setNote(e.target.value)}
          className="min-w-0 flex-1 basis-60 text-[12.5px]"
        />
      ) : null}
      <Button type="submit" variant="ghost" className={QUIET} disabled={actions.add.isPending || !title.trim()}>
        {ADD_LABEL[level]}
      </Button>
    </form>
  )
}
