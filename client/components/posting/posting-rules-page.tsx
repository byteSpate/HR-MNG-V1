"use client"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { listAccountsFlat, listPostingRules, listUnresolvedKeys, updatePostingRule } from "@/lib/api/posting"
import { useSession } from "@/lib/auth/session-context"
import type { PostingRule } from "@/lib/api/types"
import { AccountPicker } from "@/components/accounting/account-picker"
import { Button } from "@/components/ui/button"
import { Heading } from "@/components/ds/heading"
export function PostingRulesPage() {
  const { accessToken } = useSession()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<string | null>(null)
  const rules = useQuery({ queryKey: ["posting-rules"], queryFn: () => listPostingRules(accessToken!), enabled: !!accessToken })
  const unresolved = useQuery({ queryKey: ["posting-rules", "unresolved"], queryFn: () => listUnresolvedKeys(accessToken!), enabled: !!accessToken })
  const accounts = useQuery({ queryKey: ["accounting-accounts", "flat"], queryFn: () => listAccountsFlat(accessToken!), enabled: !!accessToken })
  const update = useMutation({ mutationFn: ({ id, accountId }: { id: string; accountId: string }) => updatePostingRule(accessToken!, id, { accountId }), onSuccess: () => { setEditing(null); queryClient.invalidateQueries({ queryKey: ["posting-rules"] }) } })
  const groups = (rules.data ?? []).reduce<Record<string, PostingRule[]>>((all, rule) => { (all[rule.event] ??= []).push(rule); return all }, {})
  return <div className="space-y-6"><header><Heading level="page" className="text-2xl">Posting rules</Heading><p className="text-sm text-muted-foreground">Finance controls which leaf account receives each system posting.</p></header>{(unresolved.data?.length ?? 0) > 0 ? <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"><p className="font-medium">{unresolved.data?.length} posting rules missing</p>{unresolved.data?.map((u) => <p key={`${u.event}|${u.key}`}>{u.event} · {u.key}</p>)}</div> : null}<div className="space-y-4">{Object.entries(groups).map(([event, rows]) => <section key={event} className="rounded-lg border p-4"><Heading level="section">{event}</Heading><div className="mt-3 space-y-2">{rows?.map((r) => <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t py-2 text-sm"><span>{r.key}</span>{editing === r.id ? <div className="flex min-w-64 items-center gap-2"><AccountPicker accounts={accounts.data ?? []} value={r.accountId} onChange={(accountId) => update.mutate({ id: r.id, accountId })} disabled={update.isPending} /><Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button></div> : <button type="button" className="text-left underline-offset-4 hover:underline pointer-coarse:py-3" onClick={() => setEditing(r.id)}>{r.account.code} · {r.account.name}</button>}</div>)}</div></section>)}</div></div>
}
