"use client"

import * as React from "react"
import { RiEyeLine, RiEyeOffLine } from "@remixicon/react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Password field with a reveal toggle.
 *
 * The toggle is a real <button type="button"> so it can be reached by keyboard
 * and never submits the form it sits in. Visibility resets to hidden on every
 * mount, so a revealed password can't outlive the screen it was typed on.
 */
function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false)
  const Icon = visible ? RiEyeOffLine : RiEyeLine

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        // Room for the toggle, so a long password never runs under the icon.
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        tabIndex={props.disabled ? -1 : 0}
        disabled={props.disabled}
        className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r text-ink-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export { PasswordInput }
