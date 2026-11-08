"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  RiAddLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiLockLine,
  RiPencilLine,
  RiRefreshLine,
  RiTeamLine,
  RiWallet3Line,
} from "@remixicon/react"

import { ApiError } from "@/lib/api/client"
import {
  createSalaryStructure,
  deleteSalaryStructure,
  listSalaryStructures,
  updateSalaryStructure,
} from "@/lib/api/payroll"
import { useSession } from "@/lib/auth/session-context"
import type {
  ComponentCalc,
  ComponentKind,
  Currency,
  SalaryStructure,
  SalaryStructureInput,
} from "@/lib/api/types"
import { formatMoney } from "@/lib/money"
import { PageHeader } from "@/components/dashboard/page-header"
import {
  FINANCE_ROLES as EXPORT_ROLES,
  ImportExportTools,
} from "@/components/import-export/import-export-tools"
import { PanelAlert } from "@/components/dashboard/record-kit"
import { Tag } from "@/components/dashboard/tag"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { FINANCE_ROLES } from "@/components/payroll/payroll-shared"
import { Heading } from "@/components/ds/heading"

/** A component row while it is being edited — strings, so a field can be empty. */
interface DraftComponent {
  code: string
  label: string
  kind: ComponentKind
  calc: ComponentCalc
  value: string
  /**
   * Whether this counts toward §119 leave pay and the §2(10) gratuity base.
   *
   * The column has existed since the BD Labour Act work and the API has always
   * accepted it, but nothing in this editor ever set it — so every component
   * ever created here took the `true` default, and a bonus line has been
   * inflating gratuity and leave encashment for everyone on that structure.
   */
  countsAsWages: boolean
}

interface Draft {
  id: string | null
  name: string
  currency: Currency
  basic: string
  isActive: boolean
  components: DraftComponent[]
}

/**
 * What each value is called, for the closed trigger. Base UI's Select
 * renders the raw value without these — "PERCENT_OF_BASIC" where the open
 * list read "% of basic".
 */
const KIND_ITEMS = { EARNING: "Earning", DEDUCTION: "Deduction" }
const CALC_ITEMS = { FIXED: "Fixed", PERCENT_OF_BASIC: "% of basic" }

const BLANK_COMPONENT: DraftComponent = {
  code: "",
  label: "",
  kind: "EARNING",
  calc: "FIXED",
  value: "",
  // Matches the column default. Most earnings are wages; bonus and overtime
  // are the exceptions, and now they can be marked as such.
  countsAsWages: true,
}

/**
 * A new structure starts flat: a name and a monthly salary, nothing else.
 *
 * That is how private-sector pay in Bangladesh is normally agreed — one
 * negotiated figure. Allowances and deductions exist for the workplaces that
 * split pay, but they are opt-in and start closed, so the common case is two
 * fields rather than a table.
 */
const BLANK_DRAFT: Draft = {
  id: null,
  name: "",
  currency: "BDT",
  basic: "",
  isActive: true,
  components: [],
}

function toDraft(structure: SalaryStructure): Draft {
  return {
    id: structure.id,
    name: structure.name,
    currency: structure.currency,
    basic: structure.basic,
    isActive: structure.isActive,
    components: structure.components.map((c) => ({
      code: c.code,
      label: c.label,
      kind: c.kind,
      calc: c.calc,
      value: c.value,
      countsAsWages: c.countsAsWages,
    })),
  }
}

function toInput(draft: Draft): SalaryStructureInput {
  return {
    name: draft.name.trim(),
    currency: draft.currency,
    basic: Number(draft.basic),
    isActive: draft.isActive,
    components: draft.components.map((c, i) => ({
      code: c.code.trim().toUpperCase(),
      label: c.label.trim(),
      kind: c.kind,
      calc: c.calc,
      value: Number(c.value),
      sortOrder: i,
      // A deduction is not wages by definition, so the flag only means
      // something on the earnings side. Sending it regardless keeps the two
      // sides of the round trip identical.
      countsAsWages: c.kind === "EARNING" ? c.countsAsWages : false,
    })),
  }
}

/**
 * The gross a structure produces at a full month, shown live while editing.
 *
 * Mirrors `computePayslip`'s earnings side only — it is a preview to catch a
 * percentage typed as 50 instead of 5, not a second implementation of payroll.
 * The server's figure is the one that gets paid.
 */
function previewGross(draft: Draft): { gross: number; deductions: number } {
  const basic = Number(draft.basic) || 0
  let gross = basic
  let deductions = 0
  for (const c of draft.components) {
    const raw = Number(c.value) || 0
    const amount = c.calc === "PERCENT_OF_BASIC" ? (basic * raw) / 100 : raw
    if (c.kind === "EARNING") gross += amount
    else deductions += amount
  }
  return { gross, deductions }
}

/** What a structure pays at a full month. Same arithmetic as the live preview. */
function totalsOf(structure: SalaryStructure): {
  gross: number
  deductions: number
  net: number
} {
  const basic = Number(structure.basic) || 0
  let gross = basic
  let deductions = 0
  for (const c of structure.components) {
    const raw = Number(c.value) || 0
    const amount = c.calc === "PERCENT_OF_BASIC" ? (basic * raw) / 100 : raw
    if (c.kind === "EARNING") gross += amount
    else deductions += amount
  }
  return { gross, deductions, net: gross - deductions }
}

/**
 * One structure, led by what it pays.
 *
 * The card used to open on the name with the money in 12.5px grey underneath —
 * `Basic ৳40,000 · 2 earnings, 1 deduction` — and never showed the gross at
 * all. Since the reason anybody looks at this page is to compare what two
 * bands cost, the monthly figure is now the headline and the components are
 * an aligned ledger beneath it.
 */
function StructureCard({
  structure,
  canWrite,
  confirming,
  deleting,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  structure: SalaryStructure
  canWrite: boolean
  confirming: boolean
  deleting: boolean
  onEdit: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}) {
  const totals = totalsOf(structure)
  const split = structure.components.length > 0
  const inUse = structure.employeeCount > 0

  return (
    <div
      className={cn(
        "flex flex-col rounded-md border bg-white transition-[border-color,box-shadow] duration-180 ease-out",
        "hover:border-line-strong hover:shadow-[0_10px_24px_-16px_rgba(28,39,51,0.28)]",
        // An inactive structure is still real and still pays the people on it,
        // so it is marked rather than dimmed into unreadability.
        structure.isActive ? "border-line" : "border-dashed border-line-strong",
        "motion-reduce:transition-none"
      )}
    >
      <div className="px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Heading level="card">{structure.name}</Heading>
              {structure.isActive ? null : <Tag label="Inactive" tone="neutral" />}
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-heading text-heading font-bold tracking-tight tabular-nums">
                {formatMoney(totals.net.toFixed(2), structure.currency)}
              </span>
              <span className="text-caption text-ink-muted">
                {split ? "net per month" : "per month"}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-caption text-ink-muted">
              <RiTeamLine className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
              {inUse
                ? `${structure.employeeCount} employee${structure.employeeCount === 1 ? "" : "s"}`
                : "Nobody assigned"}
            </div>
          </div>

          {/* Quiet until hover. These were two underlined links with the
              second permanently red — a red word on every card, attached to
              the action you least want clicked. */}
          {canWrite ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                onClick={onEdit}
                className="h-auto gap-1 rounded-md px-2 py-1 text-caption font-semibold text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-body"
              >
                <RiPencilLine className="size-3.5" aria-hidden />
                Edit
              </Button>
              {inUse ? (
                // Disabled with the reason on it: the server refuses this, and
                // a button that exists only to fail is worse than one that
                // explains itself.
                <span
                  title={`${structure.employeeCount} employee${
                    structure.employeeCount === 1 ? " is" : "s are"
                  } on this structure. Move them first, or mark it inactive.`}
                  className="inline-flex cursor-help items-center gap-1 rounded-md px-2 py-1 text-caption font-semibold text-ink-muted"
                >
                  <RiLockLine className="size-3.5" aria-hidden />
                  In use
                </span>
              ) : (
                <Button
                  variant="ghost"
                  onClick={onAskDelete}
                  className="h-auto gap-1 rounded-md px-2 py-1 text-caption font-semibold text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger"
                >
                  <RiDeleteBinLine className="size-3.5" aria-hidden />
                  Delete
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Confirmed in place rather than in a modal: the thing being deleted
          stays on screen, including the figure it pays. */}
      {confirming ? (
        <div className="mx-5 mb-4 rounded-md border border-danger-line bg-danger-tint px-4 py-3">
          <div className="flex items-start gap-2 text-caption leading-relaxed text-danger">
            <RiErrorWarningLine className="mt-px size-4 shrink-0" aria-hidden />
            <span>
              Delete <strong>{structure.name}</strong>? Payslips already issued on it keep their own
              figures and are unaffected.
            </span>
          </div>
          <div className="mt-2.5 flex gap-2">
            <Button
              className="h-auto rounded-md bg-danger px-3.5 py-2 text-caption font-bold text-white hover:bg-danger"
              disabled={deleting}
              onClick={onConfirmDelete}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
            <Button variant="outline" size="sm" disabled={deleting} onClick={onCancelDelete}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {split ? (
        <>
          <dl className="border-t border-surface-sunken px-5 py-3 text-caption">
            <Line
              label="Basic"
              amount={formatMoney(structure.basic, structure.currency)}
              tone="basic"
            />
            {structure.components.map((c) => (
              <Line
                key={c.id}
                label={c.label}
                code={c.code}
                note={c.kind === "EARNING" && !c.countsAsWages ? "not wages" : undefined}
                amount={
                  c.calc === "PERCENT_OF_BASIC"
                    ? `${c.value}% of basic`
                    : formatMoney(c.value, structure.currency)
                }
                tone={c.kind === "DEDUCTION" ? "deduction" : "earning"}
              />
            ))}
          </dl>

          {/* The three figures a structure is judged by, on one line. */}
          <div className="mt-auto flex flex-wrap gap-x-6 gap-y-1 border-t border-surface-sunken bg-surface-subtle px-5 py-2.5 text-caption">
            <Total label="Gross" value={formatMoney(totals.gross.toFixed(2), structure.currency)} />
            <Total
              label="Deductions"
              value={formatMoney(totals.deductions.toFixed(2), structure.currency)}
            />
            <Total
              label="Net"
              value={formatMoney(totals.net.toFixed(2), structure.currency)}
              strong
            />
          </div>
        </>
      ) : null}
    </div>
  )
}

/** One row of the ledger: what it is on the left, what it is worth on the right. */
function Line({
  label,
  code,
  note,
  amount,
  tone,
}: {
  label: string
  code?: string
  note?: string
  amount: string
  tone: "basic" | "earning" | "deduction"
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <dt className="flex min-w-0 items-baseline gap-1.5">
        {tone === "basic" ? null : (
          <span
            aria-hidden
            className={cn(
              "w-2 shrink-0 font-bold",
              tone === "deduction" ? "text-danger" : "text-success"
            )}
          >
            {tone === "deduction" ? "−" : "+"}
          </span>
        )}
        <span className={cn("truncate", tone === "basic" && "font-semibold")}>{label}</span>
        {code ? (
          <span className="shrink-0 rounded bg-surface-hover px-1 font-mono text-caption text-ink-muted">
            {code}
          </span>
        ) : null}
        {note ? <span className="shrink-0 text-caption text-warning">{note}</span> : null}
      </dt>
      <dd className="shrink-0 tabular-nums">{amount}</dd>
    </div>
  )
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-ink-muted">{label}</span>
      <span className={cn("tabular-nums", strong ? "font-bold" : "font-semibold")}>{value}</span>
    </div>
  )
}

export function SalaryStructuresPage() {
  const { accessToken, user, status } = useSession()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const isAuthed = status === "authenticated" && !!accessToken
  const canWrite = !!user && FINANCE_ROLES.includes(user.role)

  const structuresQuery = useQuery({
    queryKey: ["salary-structures"],
    queryFn: () => listSalaryStructures(accessToken!),
    enabled: isAuthed,
  })

  const saveMutation = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? updateSalaryStructure(accessToken!, d.id, toInput(d))
        : createSalaryStructure(accessToken!, toInput(d)),
    onSuccess: () => {
      setDraft(null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] })
      // The employee directory prints structure names, so it is now stale.
      queryClient.invalidateQueries({ queryKey: ["employees"] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again."),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSalaryStructure(accessToken!, id),
    onSuccess: () => {
      setConfirmingId(null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: ["salary-structures"] })
    },
    onError: (err) => {
      setConfirmingId(null)
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.")
    },
  })

  if (!isAuthed) return <Skeleton className="h-64 w-full" />

  const structures = structuresQuery.data ?? []

  function patch(changes: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...changes } : d))
  }

  function patchComponent(index: number, changes: Partial<DraftComponent>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            components: d.components.map((c, i) => (i === index ? { ...c, ...changes } : c)),
          }
        : d
    )
  }

  const preview = draft ? previewGross(draft) : null

  return (
    <>
      <PageHeader
        kicker="Configuration"
        title="Salary structures"
        sub="The pay bands every payslip is computed from"
        aside={
          <ImportExportTools
            basePath="/api/payroll/salary-structures"
            fileName="salary-structures"
            roles={EXPORT_ROLES}
            onError={setError}
            exportDisabled={structuresQuery.isPending || structuresQuery.isError}
          />
        }
      />

      {error ? (
        <div className="mb-4">
          <PanelAlert onDismiss={() => setError(null)}>{error}</PanelAlert>
        </div>
      ) : null}

      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-body-sm text-ink-muted">
            Finance authors these; HR assigns employees to them from the employee directory.
          </div>
          {canWrite && !draft ? (
            <Button
              className="h-auto rounded-md bg-ink px-3.5 py-2 text-caption font-bold text-white hover:bg-ink-strong"
              onClick={() => setDraft({ ...BLANK_DRAFT, components: [{ ...BLANK_COMPONENT }] })}
            >
              <RiAddLine className="size-4" aria-hidden />
              New structure
            </Button>
          ) : null}
        </div>

        {draft ? (
          // A left rule and a tint so the editor does not read as one more
          // card in the list it sits above.
          <div className="space-y-4 rounded-md border border-line border-l-3 border-l-ink bg-surface-subtle px-5.5 py-5">
            <div className="flex items-center gap-2">
              <RiWallet3Line className="size-4 text-ink-muted" aria-hidden />
              <Heading level="section">
                {draft.id ? `Edit ${draft.name || "structure"}` : "New structure"}
              </Heading>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="s-name" className="mb-1.5 text-xs font-bold">
                  Name
                </Label>
                <Input
                  id="s-name"
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="Standard (BDT)"
                />
              </div>
              <div>
                <Label htmlFor="s-currency" className="mb-1.5 text-xs font-bold">
                  Currency
                </Label>
                <Select
                  value={draft.currency}
                  // Immutable after creation: changing it silently
                  // re-denominates every figure already on the structure.
                  disabled={!!draft.id}
                  onValueChange={(v) => patch({ currency: v as Currency })}
                >
                  <SelectTrigger id="s-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BDT">BDT</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="s-basic" className="mb-1.5 text-xs font-bold">
                  {/* "Basic" only means something once pay is split. With no
                      components it is simply the salary. */}
                  {draft.components.length > 0 ? "Basic" : "Monthly salary"}
                </Label>
                <Input
                  id="s-basic"
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.basic}
                  onChange={(e) => patch({ basic: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="s-active"
                nativeButton
                render={<button type="button" />}
                checked={draft.isActive}
                onCheckedChange={(v) => patch({ isActive: v })}
              />
              <Label htmlFor="s-active" className="text-caption font-normal">
                Active — inactive structures cannot be assigned to anyone new
              </Label>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-body-sm font-semibold">
                    Allowances and deductions{" "}
                    <span className="font-normal text-ink-muted">· optional</span>
                  </div>
                  {draft.components.length === 0 ? (
                    <div className="mt-0.5 text-caption text-ink-muted">
                      Leave this empty for a flat monthly salary — the usual case.
                    </div>
                  ) : null}
                </div>
                <Button
                  variant="link" className="h-auto p-0 text-caption font-semibold underline"
                  onClick={() =>
                    patch({ components: [...draft.components, { ...BLANK_COMPONENT }] })
                  }
                >
                  {draft.components.length === 0 ? "Split this salary" : "Add another"}
                </Button>
              </div>

              {/* Column headers. Six unlabelled inputs in a row is a puzzle:
                  nothing said which box wanted a code and which a label, and
                  the stacked mobile layout was worse still. Hidden below `sm`,
                  where each row becomes its own labelled block instead. */}
              {draft.components.length > 0 ? (
                <div className="mb-1.5 hidden gap-2 px-0.5 text-caption font-bold tracking-wide text-ink-muted uppercase sm:grid sm:grid-cols-[0.7fr_1.2fr_0.8fr_1fr_0.8fr_auto]">
                  <span>Code</span>
                  <span>Label</span>
                  <span>Kind</span>
                  <span>How</span>
                  <span>Value</span>
                  <span className="sr-only">Remove</span>
                </div>
              ) : null}

              <div className="space-y-3 sm:space-y-2">
                {draft.components.map((c, i) => (
                  <div
                    key={i}
                    className="grid gap-2 rounded-md border border-surface-sunken p-3 sm:grid-cols-[0.7fr_1.2fr_0.8fr_1fr_0.8fr_auto] sm:rounded-none sm:border-0 sm:p-0"
                  >
                    <Input
                      value={c.code}
                      aria-label="Component code"
                      onChange={(e) => patchComponent(i, { code: e.target.value })}
                      placeholder="CODE"
                      className="font-mono uppercase"
                    />
                    <Input
                      value={c.label}
                      aria-label="Component label"
                      onChange={(e) => patchComponent(i, { label: e.target.value })}
                      placeholder="Label"
                    />
                    <Select
                      items={KIND_ITEMS}
                      value={c.kind}
                      onValueChange={(v) => patchComponent(i, { kind: v as ComponentKind })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EARNING">Earning</SelectItem>
                        <SelectItem value="DEDUCTION">Deduction</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      items={CALC_ITEMS}
                      value={c.calc}
                      onValueChange={(v) => patchComponent(i, { calc: v as ComponentCalc })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FIXED">Fixed</SelectItem>
                        <SelectItem value="PERCENT_OF_BASIC">% of basic</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label="Component value"
                      value={c.value}
                      onChange={(e) => patchComponent(i, { value: e.target.value })}
                      placeholder={c.calc === "PERCENT_OF_BASIC" ? "%" : "Amount"}
                    />
                    {/* Removing the last one is allowed — that is how a split
                        salary goes back to being a flat one. */}
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${c.label || "component"}`}
                      className="h-auto justify-start gap-1 rounded-md px-2 py-1 text-caption font-semibold text-ink-muted transition-colors hover:bg-danger-tint hover:text-danger sm:justify-center"
                      onClick={() =>
                        patch({ components: draft.components.filter((_, j) => j !== i) })
                      }
                    >
                      <RiDeleteBinLine className="size-3.5" aria-hidden />
                      <span className="sm:sr-only">Remove</span>
                    </Button>

                    {/* Full width under the row it belongs to. Only earnings
                        can be wages, so a deduction does not ask. */}
                    {c.kind === "EARNING" ? (
                      <label className="flex cursor-pointer items-start gap-2 text-caption leading-relaxed text-ink-muted sm:col-span-6 sm:-mt-0.5 sm:pl-0.5">
                        <Checkbox
                          nativeButton
                          render={<button type="button" />}
                          checked={c.countsAsWages}
                          onCheckedChange={(v) => patchComponent(i, { countsAsWages: v === true })}
                          className="mt-px"
                        />
                        <span>
                          Counts as wages
                          <span className="text-ink-muted">
                            {" "}
                            — included in leave encashment and the gratuity base. Clear it for
                            bonus and overtime.
                          </span>
                        </span>
                      </label>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Catches a percentage typed as 50 instead of 5 before it
                reaches a payslip, where preflight would only call it a
                negative net pay. */}
            {preview && draft.components.length === 0 ? (
              <div className="rounded-md bg-surface-subtle px-4 py-3 text-caption">
                <span className="text-ink-muted">Take-home at a full month: </span>
                <span className="font-semibold">
                  {formatMoney(preview.gross.toFixed(2), draft.currency)}
                </span>
              </div>
            ) : preview ? (
              <div className="flex flex-wrap gap-6 rounded-md bg-surface-subtle px-4 py-3 text-caption">
                <div>
                  <span className="text-ink-muted">Gross at a full month: </span>
                  <span className="font-semibold">
                    {formatMoney(preview.gross.toFixed(2), draft.currency)}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted">Deductions: </span>
                  <span className="font-semibold">
                    {formatMoney(preview.deductions.toFixed(2), draft.currency)}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted">Net: </span>
                  <span
                    className={`font-semibold ${
                      preview.gross - preview.deductions < 0 ? "text-danger" : ""
                    }`}
                  >
                    {formatMoney((preview.gross - preview.deductions).toFixed(2), draft.currency)}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                disabled={saveMutation.isPending || !draft.name.trim() || !draft.basic}
                onClick={() => saveMutation.mutate(draft)}
              >
                {saveMutation.isPending ? "Saving…" : "Save structure"}
              </Button>
              <Button variant="outline" onClick={() => setDraft(null)} disabled={saveMutation.isPending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {structuresQuery.isPending ? (
          // Shaped like the grid it replaces, so nothing jumps when the data
          // lands. Was one full-width grey slab.
          <div className="grid gap-4 lg:grid-cols-2">
            {[0, 1].map((card) => (
              <div key={card} className="space-y-3 rounded-md border border-line bg-white px-5 py-4">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-6 w-1/2" />
                <div className="space-y-1.5 border-t border-surface-sunken pt-3">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : structuresQuery.isError ? (
          <div className="rounded-md border border-line bg-white px-5.5 py-8 text-center">
            <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-danger-tint text-danger">
              <RiErrorWarningLine className="size-5" aria-hidden />
            </span>
            <div className="text-body-sm font-bold">Salary structures could not be loaded</div>
            <p className="mt-1 text-caption text-ink-muted">
              Nothing has changed. Check the connection and try again.
            </p>
            <Button
              className="mt-3 h-auto rounded-md bg-ink px-3.5 py-2 text-caption font-bold text-white hover:bg-ink-strong"
              onClick={() => structuresQuery.refetch()}
            >
              <RiRefreshLine className="size-4" aria-hidden />
              Retry
            </Button>
          </div>
        ) : structures.length === 0 ? (
          // The old empty state said payroll could not run and then offered
          // nothing to do about it.
          <div className="rounded-md border border-line bg-white px-5.5 py-10 text-center">
            <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-surface-hover text-ink-muted">
              <RiWallet3Line className="size-5" aria-hidden />
            </span>
            <div className="text-body-sm font-bold">No salary structures yet</div>
            <p className="mx-auto mt-1 max-w-[46ch] text-caption leading-relaxed text-ink-muted">
              A structure is the pay band a payslip is computed from. Payroll cannot run until at
              least one exists.
            </p>
            {canWrite && !draft ? (
              <Button
                className="mt-3 h-auto rounded-md bg-ink px-3.5 py-2 text-caption font-bold text-white hover:bg-ink-strong"
                onClick={() =>
                  setDraft({ ...BLANK_DRAFT, components: [{ ...BLANK_COMPONENT }] })
                }
              >
                <RiAddLine className="size-4" aria-hidden />
                Create the first structure
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {structures.map((s) => (
              <StructureCard
                key={s.id}
                structure={s}
                canWrite={canWrite}
                confirming={confirmingId === s.id}
                deleting={deleteMutation.isPending}
                onEdit={() => {
                  setError(null)
                  setConfirmingId(null)
                  setDraft(toDraft(s))
                }}
                onAskDelete={() => {
                  setError(null)
                  setConfirmingId(s.id)
                }}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={() => deleteMutation.mutate(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
