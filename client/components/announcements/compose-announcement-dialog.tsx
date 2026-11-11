"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type {
  AnnouncementAudience,
  AnnouncementItem,
  CreateAnnouncementInput,
  Department,
  Role,
} from "@/lib/api/types"
import { dialogWidthClass } from "@/components/ds/dialog-sizes"

const ROLES: Role[] = [
  "SUPER_ADMIN",
  "HR_ADMIN",
  "FINANCE_OFFICER",
  "REPORTING_MANAGER",
  "EMPLOYEE",
]

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admins",
  HR_ADMIN: "HR Admins",
  FINANCE_OFFICER: "Finance Officers",
  REPORTING_MANAGER: "Reporting Managers",
  EMPLOYEE: "Employees",
}

/**
 * What the closed trigger shows. Base UI's Select renders the raw value
 * without these — the enum key for a role, and a uuid for a department.
 */
const AUDIENCE_ITEMS = { ALL: "Everyone", DEPARTMENT: "A department", ROLE: "A role" }
const ROLE_ITEMS = { "": "Choose a role…", ...ROLE_LABEL }

/** `2026-08-05T04:00:00.000Z` → `2026-08-05T10:00`, for a datetime-local input. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ComposeAnnouncementDialog({
  open,
  onOpenChange,
  existing,
  departments,
  managerScoped,
  pending,
  error,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  existing?: AnnouncementItem
  departments: Department[]
  /**
   * The composer is a Reporting Manager, who may only announce to their own
   * department. No picker is shown and **no `departmentId` is sent** — the
   * server reads it from their employee record, which is the one place it
   * cannot be escalated from. Offering a picker the server overrides would
   * teach the user something false.
   */
  managerScoped?: boolean
  pending: boolean
  error: string | null
  onSubmit: (input: CreateAnnouncementInput) => void
}) {
  const departmentItems = useMemo(
    () => ({
      "": "Choose a department…",
      ...Object.fromEntries(departments.map((d) => [d.id, d.name])),
    }),
    [departments]
  )

  const [title, setTitle] = useState(existing?.title ?? "")
  const [body, setBody] = useState(existing?.body ?? "")
  // A manager may only announce to their own department, so that is the only
  // audience they are ever offered.
  const [audience, setAudience] = useState<AnnouncementAudience>(
    existing?.audience ?? (managerScoped ? "DEPARTMENT" : "ALL")
  )
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? "")
  const [targetRole, setTargetRole] = useState<Role | "">(existing?.targetRole ?? "")
  const [publishAt, setPublishAt] = useState(
    existing?.publishedAt ? toLocalInput(existing.publishedAt) : ""
  )
  const [draft, setDraft] = useState(existing ? existing.publishedAt === null : false)

  // Mirrors the server's `superRefine`, so the form cannot construct a body
  // the API will reject.
  const targetOk =
    audience === "ALL" ||
    (audience === "DEPARTMENT" && (managerScoped || departmentId !== "")) ||
    (audience === "ROLE" && targetRole !== "")
  const canSubmit = title.trim() !== "" && body.trim() !== "" && targetOk && !pending

  function submit() {
    onSubmit({
      title: title.trim(),
      body: body.trim(),
      audience,
      // Omitted entirely for a manager — the server supplies it.
      ...(audience === "DEPARTMENT" && !managerScoped ? { departmentId } : {}),
      ...(audience === "ROLE" ? { targetRole: targetRole as Role } : {}),
      // Three distinct states, and they must stay distinct: explicit null
      // keeps it a draft, a datetime schedules it, and omitting the field
      // entirely publishes now.
      ...(draft
        ? { publishedAt: null }
        : publishAt
          ? { publishedAt: new Date(publishAt).toISOString() }
          : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogWidthClass("md")}>
        <DialogHeader>
          <DialogTitle>{existing ? "Edit announcement" : "New announcement"}</DialogTitle>
          <DialogDescription>
            Everyone in the audience sees this on their announcements page. There are no read
            receipts. Nobody can tell you who has actually read it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ann-title">Title</Label>
            <Input
              id="ann-title"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Office closed on Sunday"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ann-body">Body</Label>
            <Textarea
              id="ann-body"
              value={body}
              rows={5}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What people need to know, and by when."
            />
          </div>

          {managerScoped ? (
            <div className="rounded-md bg-surface-hover px-3.5 py-2.5 text-caption text-ink-muted">
              This goes to <span className="font-semibold">your own department</span>. Managers can
              only announce to their own team.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-audience">Audience</Label>
              <Select
                items={AUDIENCE_ITEMS}
                value={audience}
                onValueChange={(v) => setAudience(v as AnnouncementAudience)}
              >
                <SelectTrigger id="ann-audience" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Everyone</SelectItem>
                  <SelectItem value="DEPARTMENT">A department</SelectItem>
                  <SelectItem value="ROLE">A role</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {!managerScoped && audience === "DEPARTMENT" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-department">Department</Label>
              <Select
                items={departmentItems}
                value={departmentId}
                onValueChange={(v) => setDepartmentId(v as string)}
              >
                <SelectTrigger id="ann-department" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Kept as a real item rather than Base UI's null-placeholder
                      so the field stays clearable and `departmentId` stays a
                      plain string for the submit-time checks. */}
                  <SelectItem value="">Choose a department…</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {audience === "ROLE" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ann-role">Role</Label>
              <Select items={ROLE_ITEMS} value={targetRole} onValueChange={(v) => setTargetRole(v as Role)}>
                <SelectTrigger id="ann-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Choose a role…</SelectItem>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ann-when">Publish</Label>
            <Input
              id="ann-when"
              type="datetime-local"
              value={publishAt}
              disabled={draft}
              onChange={(e) => setPublishAt(e.target.value)}
            />
            <div className="flex items-center gap-2">
              {/* `nativeButton` + a rendered <Button> is what lets a sibling
                  <Label htmlFor> actually toggle it — the default Base UI root
                  is not a labelable element. */}
              <Checkbox
                id="ann-draft"
                nativeButton
                render={<button type="button" />}
                checked={draft}
                onCheckedChange={(v) => setDraft(v)}
              />
              <Label htmlFor="ann-draft" className="text-caption font-normal text-ink-muted">
                Save as a draft. Nobody sees it until you publish
              </Label>
            </div>
            {!draft && !publishAt ? (
              <span className="text-caption text-ink-muted">Leave empty to publish immediately.</span>
            ) : null}
          </div>

          {error ? <div className="text-caption font-semibold text-danger">{error}</div> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? "Saving…" : existing ? "Save changes" : draft ? "Save draft" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
