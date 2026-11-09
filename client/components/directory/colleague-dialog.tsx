"use client"

import { useState } from "react"
import { RiMailLine, RiPhoneLine, RiZoomInLine } from "@remixicon/react"

import type { EmployeeView } from "@/lib/api/types"
import { AvatarLightbox } from "@/components/dashboard/avatar-lightbox"
import { UserAvatar } from "@/components/dashboard/user-avatar"
import { Tag } from "@/components/dashboard/tag"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { dialogWidthClass } from "@/components/ds/dialog-sizes"
import { cx } from "@/components/ds/classes"

/**
 * Seven fields of work identity, for the person who opened this from a
 * directory card. A dialog rather than a route: seven fields do not warrant
 * a page, a back button and a loading state.
 *
 * Shaped like a contact card rather than a form — a header (who), then the
 * ways to reach them, then who they report to. The original was five
 * label/value rows of equal weight, which gave "Designation" the same visual
 * footing as the two fields someone actually came here to tap.
 */
export function ColleagueDialog({
  employee,
  onOpenChange,
}: {
  employee: EmployeeView | null
  onOpenChange: (open: boolean) => void
}) {
  // A sibling Dialog rather than one nested in this one's content: two
  // independently-driven overlays that happen to stack.
  const [photoOpen, setPhotoOpen] = useState(false)

  return (
    <>
      <Dialog open={!!employee} onOpenChange={onOpenChange}>
        <DialogContent className={cx(dialogWidthClass("sm"), "p-5")}>
          {employee ? (
            <>
              <DialogHeader className="flex-row items-center gap-4 pr-6">
                {employee.work.avatarUrl ? (
                  // The magnifier appears only when there is a real photo to
                  // open; two initials have nothing a lightbox would add.
                  <button
                    type="button"
                    onClick={() => setPhotoOpen(true)}
                    aria-label={`View ${employee.work.fullName}'s photo`}
                    className="group relative shrink-0 cursor-zoom-in rounded-2xl transition-transform duration-150 ease-out-quint hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ink/30 focus-visible:outline-none active:translate-y-0 active:scale-97 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    <UserAvatar
                      name={employee.work.fullName}
                      avatarUrl={employee.work.avatarUrl}
                      className="size-22 rounded-2xl"
                      textClassName="text-display"
                    />
                    {/* Touch has no hover state, so this simply never shows
                        on a phone — where the tap opens the photo anyway and
                        needs no hint to be discoverable. */}
                    <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/45 text-white opacity-0 transition-opacity duration-150 ease-out-quint group-hover:opacity-100 motion-reduce:transition-none">
                      <RiZoomInLine className="size-5" aria-hidden="true" />
                    </span>
                  </button>
                ) : (
                  <UserAvatar
                    name={employee.work.fullName}
                    avatarUrl={employee.work.avatarUrl}
                    className="size-22 rounded-2xl"
                    textClassName="text-display"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <DialogTitle className="truncate text-title-sm">
                    {employee.work.fullName}
                  </DialogTitle>
                  <div className="mt-1 truncate text-body-sm text-ink-muted">
                    {employee.work.designation}
                  </div>
                  <div className="mt-2.5">
                    <Tag label={employee.work.department.name} tone="neutral" />
                  </div>
                </div>
              </DialogHeader>

              {/* Stacked full-width rows, not a two-up grid. A work email is
                  routinely 30+ characters; at half the dialog's width it
                  truncated to "rezaul212002044@d..." which is unusable for
                  the one thing this card exists to give you. */}
              <div className="grid gap-2 border-t border-surface-sunken pt-4">
                <ContactRow
                  icon={RiMailLine}
                  label="Email"
                  value={employee.work.email}
                  href={`mailto:${employee.work.email}`}
                />
                {employee.work.phone ? (
                  <ContactRow
                    icon={RiPhoneLine}
                    label="Phone"
                    value={employee.work.phone}
                    href={`tel:${employee.work.phone}`}
                  />
                ) : null}
              </div>

              {employee.work.reportingManager ? (
                <div className="flex items-center gap-3 rounded-lg bg-surface-subtle px-3.5 py-3">
                  <UserAvatar
                    name={employee.work.reportingManager.fullName}
                    className="size-9"
                    textClassName="text-caption"
                  />
                  <div className="min-w-0">
                    <div className="text-caption font-bold tracking-wide text-ink-muted uppercase">
                      Reports to
                    </div>
                    <div className="truncate text-body-sm font-semibold">
                      {employee.work.reportingManager.fullName}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {employee?.work.avatarUrl ? (
        <AvatarLightbox
          src={employee.work.avatarUrl}
          alt={employee.work.fullName}
          open={photoOpen}
          onOpenChange={setPhotoOpen}
        />
      ) : null}
    </>
  )
}

/**
 * A named action rather than plain underlined text — the two things a
 * directory lookup is actually for. The icon square inverts on hover so the
 * row reads as pressable before the cursor reaches it, and it lifts and dips
 * like the directory card that opened this dialog, so nothing here
 * introduces a second interaction language.
 */
function ContactRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof RiMailLine
  label: string
  value: string
  href: string
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-line px-3.5 py-3 transition-[transform,border-color,background-color] duration-150 ease-out-quint hover:-translate-y-0.5 hover:border-line-strong hover:bg-surface-subtle active:translate-y-0 active:scale-99 active:duration-100 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-hover text-ink-muted transition-colors duration-150 ease-out-quint group-hover:bg-ink group-hover:text-white motion-reduce:transition-none">
        <Icon className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-caption font-bold tracking-wide text-ink-muted uppercase">{label}</div>
        <div className="truncate text-body-sm font-semibold text-ink">{value}</div>
      </div>
    </a>
  )
}
