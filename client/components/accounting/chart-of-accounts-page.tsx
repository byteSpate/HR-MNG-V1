"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiBankLine,
  RiCashLine,
  RiDeleteBinLine,
  RiPencilLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { deleteAccount, listAccountTree, listAccountsFlat } from "@/lib/api/accounting"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { Account, AccountNode, AccountType } from "@/lib/api/types"
import { PageHeader } from "@/components/dashboard/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AccountDialog } from "@/components/accounting/account-dialog"
import { HelpLink } from "@/components/help/help-link"

function Row({
  node,
  depth,
  expanded,
  onToggle,
  onEdit,
  onAddChild,
  onDelete,
}: {
  node: AccountNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onEdit: (node: AccountNode) => void
  onAddChild: (node: AccountNode) => void
  onDelete: (node: AccountNode) => void
}) {
  const isOpen = expanded.has(node.id)
  const hasChildren = node.children.length > 0

  return (
    <>
      <div
        className="group flex items-center gap-2 border-b py-2 pr-2 text-sm last:border-0 hover:bg-muted/40"
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={isOpen ? "Collapse" : "Expand"}
            className="rounded p-0.5 hover:bg-muted"
          >
            {isOpen ? (
              <RiArrowDownSLine className="size-4" />
            ) : (
              <RiArrowRightSLine className="size-4" />
            )}
          </button>
        ) : (
          <span className="size-5" />
        )}

        <span className="w-12 shrink-0 text-muted-foreground tabular-nums">{node.code}</span>
        <span className={node.isGroup ? "font-medium" : ""}>{node.name}</span>

        {node.cashKind === "CASH" && <RiCashLine className="size-4 text-muted-foreground" />}
        {node.cashKind === "BANK" && <RiBankLine className="size-4 text-muted-foreground" />}
        {node.systemRole && (
          <Badge variant="outline" className="text-caption font-normal">
            {node.systemRole.replaceAll("_", " ").toLowerCase()}
          </Badge>
        )}
        {!node.isActive && <Badge variant="secondary">Inactive</Badge>}

        <div className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {node.isGroup && (
            <Button size="icon" variant="ghost" onClick={() => onAddChild(node)} aria-label="Add child account">
              <RiAddLine className="size-4" />
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => onEdit(node)} aria-label="Edit account">
            <RiPencilLine className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => onDelete(node)} aria-label="Delete account">
            <RiDeleteBinLine className="size-4" />
          </Button>
        </div>
      </div>

      {isOpen &&
        node.children.map((child) => (
          <Row
            key={child.id}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onEdit={onEdit}
            onAddChild={onAddChild}
            onDelete={onDelete}
          />
        ))}
    </>
  )
}

export function ChartOfAccountsPage() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AccountNode | undefined>()
  const [parentFor, setParentFor] = useState<{ id: string; type: AccountType } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AccountNode | null>(null)

  const tree = useQuery({
    queryKey: ["accounting", "accounts", "tree", search],
    queryFn: () => listAccountTree(accessToken!, search || undefined),
    enabled: Boolean(accessToken),
  })

  const flat = useQuery({
    queryKey: ["accounting", "accounts", "flat"],
    queryFn: () => listAccountsFlat(accessToken!),
    enabled: Boolean(accessToken),
  })

  const groups = useMemo(() => (flat.data ?? []).filter((a: Account) => a.isGroup), [flat.data])

  const remove = useMutation({
    mutationFn: (id: string) => deleteAccount(accessToken!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounting", "accounts"] })
      toast.success("Account deleted")
      setPendingDelete(null)
    },
    onError: (err) => {
      // The server's refusal is the useful message — it names the number of
      // journal lines or children in the way, and suggests deactivating.
      toast.error(err instanceof ApiError ? err.message : "Could not delete the account")
      setPendingDelete(null)
    },
  })

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const expandAll = () => {
    const ids = new Set<string>()
    const walk = (nodes: AccountNode[]) => {
      for (const n of nodes) {
        if (n.children.length) ids.add(n.id)
        walk(n.children)
      }
    }
    walk(tree.data ?? [])
    setExpanded(ids)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Accounting"
        title="Chart of accounts"
        sub="Groups roll up on the statements; postings go to the accounts under them."
        cta="New account"
        onCta={() => {
          setEditing(undefined)
          setParentFor(null)
          setDialogOpen(true)
        }}
      />

      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code or name…"
          className="max-w-xs"
        />
        <Button variant="outline" size="sm" onClick={expandAll}>
          Expand all
        </Button>
        <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())}>
          Collapse all
        </Button>
      </div>

      <div className="rounded-lg border">
        {tree.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : tree.isError ? (
          <div className="p-8 text-center text-sm">
            <p className="text-muted-foreground">The chart of accounts could not be loaded.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => tree.refetch()}>
              Try again
            </Button>
          </div>
        ) : (tree.data ?? []).length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {search ? `No account matches “${search}”.` : "No accounts yet."}{" "}
            <HelpLink>How does this work?</HelpLink>
          </p>
        ) : (
          (tree.data ?? []).map((node) => (
            <Row
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              onEdit={(n) => {
                setEditing(n)
                setParentFor(null)
                setDialogOpen(true)
              }}
              onAddChild={(n) => {
                setEditing(undefined)
                setParentFor({ id: n.id, type: n.type })
                setDialogOpen(true)
              }}
              onDelete={setPendingDelete}
            />
          ))
        )}
      </div>

      <AccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editing}
        parent={parentFor}
        groups={groups}
      />

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {pendingDelete?.code} {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. If the account has been used on any journal — even a draft —
              or has accounts under it, the deletion will be refused and you can deactivate it
              instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}
              disabled={remove.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
