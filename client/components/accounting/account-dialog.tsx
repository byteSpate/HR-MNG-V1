"use client"

import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { createAccount, updateAccount } from "@/lib/api/accounting"
import { ApiError } from "@/lib/api/client"
import { useSession } from "@/lib/auth/session-context"
import type { Account, AccountCashKind, AccountNode, AccountType } from "@/lib/api/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { dialogWidthClass } from "@/components/ds/dialog-sizes"

const TYPES: Array<{ value: AccountType; label: string; digit: string }> = [
  { value: "ASSET", label: "Asset", digit: "1" },
  { value: "LIABILITY", label: "Liability", digit: "2" },
  { value: "EQUITY", label: "Equity", digit: "3" },
  { value: "INCOME", label: "Income", digit: "4" },
  { value: "EXPENSE", label: "Expense", digit: "5" },
]

/**
 * What each value is called, for the closed trigger.
 *
 * Base UI's Select renders the raw *value* when its root is not given
 * `items` — so a trigger showed "PERCENT_OF_BASIC" where the open list said
 * "% of basic", and a uuid where the list said a person's name.
 */
const TYPE_ITEMS = Object.fromEntries(TYPES.map((t) => [t.value, `${t.label} (${t.digit}xxx)`]))

const CASH_KIND_ITEMS = {
  NONE: "No cash or bank book",
  CASH: "The Cash Book",
  BANK: "The Bank Book",
}

/**
 * The form body. Mounted only while the dialog is open (see AccountDialog
 * below), so every field initializes from props on mount — no effect syncing
 * state, which this repo's lint rejects, and no stale state left over from
 * the previous account.
 */
function AccountForm({
  account,
  parent,
  groups,
  onClose,
}: {
  account?: Account | AccountNode
  parent?: { id: string; type: AccountType } | null
  groups: Account[]
  onClose: () => void
}) {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const isEdit = Boolean(account)

  const [code, setCode] = useState(account?.code ?? "")
  const [name, setName] = useState(account?.name ?? "")
  const [type, setType] = useState<AccountType>(account?.type ?? parent?.type ?? "EXPENSE")
  const [parentId, setParentId] = useState<string>(
    ("parentId" in (account ?? {}) ? (account as Account).parentId : parent?.id) ?? ""
  )
  const [isGroup, setIsGroup] = useState(account?.isGroup ?? false)
  const [cashKind, setCashKind] = useState<AccountCashKind>(account?.cashKind ?? "NONE")
  const [description, setDescription] = useState(account?.description ?? "")

  const save = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error("Not signed in")
      if (isEdit && account) {
        return updateAccount(accessToken, account.id, {
          name,
          parentId: parentId || null,
          cashKind,
          description: description || null,
        })
      }
      return createAccount(accessToken, {
        code,
        name,
        type,
        parentId: parentId || undefined,
        isGroup,
        cashKind,
        description: description || undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounting", "accounts"] })
      toast.success(isEdit ? "Account updated" : "Account created")
      onClose()
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not save the account")
    },
  })

  // Only groups of the same type can be a parent — the server enforces it,
  // and offering the impossible option is how you get a 400 nobody expected.
  const eligibleParents = groups.filter((g) => g.type === type && g.id !== account?.id)
  const expectedDigit = TYPES.find((t) => t.value === type)?.digit ?? "?"

  // Base UI's <SelectValue /> renders the raw value unless the root is told
  // what each value is called, so a parent account read as its uuid.
  const parentItems = useMemo(
    () => ({
      ...(isGroup ? { none: "Top level" } : {}),
      ...Object.fromEntries(eligibleParents.map((g) => [g.id, `${g.code} ${g.name}`])),
    }),
    [eligibleParents, isGroup]
  )
  // Only a group may sit at top level; the server refuses anything else. An
  // account that takes entries with no group above it has no line on the
  // statements, and stops them all (5210 Water Bill, 2026-11-10).
  const needsGroup = !isGroup && !parentId

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isEdit ? `Edit ${account?.code}` : "New account"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "The code and type are fixed once an account exists — retyping one would move money between statements without touching a journal."
            : `A ${type.toLowerCase()} account's code starts with ${expectedDigit}.`}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4">
        {!isEdit && (
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="account-type">Type</Label>
              <Select
                items={TYPE_ITEMS}
                value={type}
                onValueChange={(v) => setType((v ?? "EXPENSE") as AccountType)}
              >
                <SelectTrigger id="account-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label} ({t.digit}xxx)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="account-code">Code</Label>
              <Input
                id="account-code"
                inputMode="numeric"
                maxLength={4}
                placeholder={`${expectedDigit}000`}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="tabular-nums"
              />
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="account-name">Name</Label>
          <Input id="account-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="account-parent">Sits under</Label>
          <Select
            items={parentItems}
            value={parentId || (isGroup ? "none" : null)}
            onValueChange={(v) => setParentId(v === "none" ? "" : (v ?? ""))}
          >
            <SelectTrigger id="account-parent">
              <SelectValue placeholder={isGroup ? "Top level" : "Choose a group"} />
            </SelectTrigger>
            <SelectContent>
              {isGroup ? <SelectItem value="none">Top level</SelectItem> : null}
              {eligibleParents.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.code} {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {needsGroup ? (
            <p className="text-xs text-muted-foreground">
              An account that takes entries must sit under a group, so the statements know which line it belongs to.
            </p>
          ) : null}
        </div>

        {!isEdit && (
          <label className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              checked={isGroup}
              onCheckedChange={(v) => {
                setIsGroup(v === true)
                if (v === true) setCashKind("NONE")
              }}
            />
            <span className="text-sm">
              <span className="font-medium">This is a group heading</span>
              <span className="block text-muted-foreground">
                Groups roll up their children on the statements. Journals cannot be posted to
                one, and this cannot be changed later.
              </span>
            </span>
          </label>
        )}

        {!isGroup && (
          <div className="grid gap-2">
            <Label htmlFor="account-cash">Appears in</Label>
            <Select
              items={CASH_KIND_ITEMS}
              value={cashKind}
              onValueChange={(v) => setCashKind((v ?? "NONE") as AccountCashKind)}
            >
              <SelectTrigger id="account-cash">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No cash or bank book</SelectItem>
                <SelectItem value="CASH">The Cash Book</SelectItem>
                <SelectItem value="BANK">The Bank Book</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="account-description">Note</Label>
          <Textarea
            id="account-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !name.trim() || (!isEdit && code.length !== 4) || needsGroup}
        >
          {save.isPending ? "Saving…" : isEdit ? "Save" : "Create account"}
        </Button>
      </DialogFooter>
    </>
  )
}

export function AccountDialog({
  open,
  onOpenChange,
  account,
  parent,
  groups,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present means edit; absent means create. */
  account?: Account | AccountNode
  /** Pre-selected parent when creating from a group's "Add child" action. */
  parent?: { id: string; type: AccountType } | null
  /** Every group account, for the parent select. */
  groups: Account[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mount the form only while open, so each open starts from the props. */}
      {open && (
        <DialogContent className={dialogWidthClass("md")}>
          <AccountForm account={account} parent={parent} groups={groups} onClose={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  )
}
