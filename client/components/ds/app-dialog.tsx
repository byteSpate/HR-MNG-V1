"use client"

import type { ReactNode } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { cx } from "./classes"
import { DIALOG_BODY_CLASS, dialogWidthClass, type DialogSize } from "./dialog-sizes"

/*
 * One dialog for the whole app. `size` sets the desktop width.
 * On a phone it fills the width with a 16 px gutter. The header and the footer stay in
 * place and the body scrolls, so the buttons stay reachable when the keyboard is open.
 * The footer buttons stack and fill the width on a phone.
 *
 * Use <AppDialog> for the common case. Use the parts (Frame, Header, Body, Footer)
 * when the content is swapped inside one open dialog, for example loading, then a form.
 */

export function AppDialogFrame({ size = "md", children }: { size?: DialogSize; children: ReactNode }) {
  return <DialogContent className={cx("gap-0 overflow-hidden p-0", dialogWidthClass(size))}>{children}</DialogContent>
}

export function AppDialogHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <DialogHeader className="px-4 pt-4 pr-12 pb-3">
      <DialogTitle className="font-heading text-title-sm font-bold">{title}</DialogTitle>
      {description ? <DialogDescription className="text-body-sm">{description}</DialogDescription> : null}
    </DialogHeader>
  )
}

export function AppDialogBody({ children }: { children: ReactNode }) {
  return <div className={cx("px-4 py-3", DIALOG_BODY_CLASS)}>{children}</div>
}

export function AppDialogFooter({ children }: { children: ReactNode }) {
  return (
    <DialogFooter className="m-0 flex-col-reverse gap-2 rounded-none border-t border-line bg-surface-subtle px-4 py-3 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto">
      {children}
    </DialogFooter>
  )
}

export function AppDialog({
  open,
  onOpenChange,
  size = "md",
  title,
  description,
  footer,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  size?: DialogSize
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AppDialogFrame size={size}>
        <AppDialogHeader title={title} description={description} />
        <AppDialogBody>{children}</AppDialogBody>
        {footer ? <AppDialogFooter>{footer}</AppDialogFooter> : null}
      </AppDialogFrame>
    </Dialog>
  )
}
