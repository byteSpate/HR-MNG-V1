"use client"

import Link from "next/link"
import { RiArrowDownSLine, RiLoader4Line, RiLogoutBoxRLine, RiMenuLine, RiUser3Line } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { NotificationBell } from "@/components/dashboard/notification-bell"
import { UserAvatar } from "@/components/dashboard/user-avatar"
import { HelpTrigger } from "@/components/help/help-sheet"
import { BackToDashboardButton } from "@/components/sales/back-to-dashboard-button"
import { SalesHubButton } from "@/components/sales/sales-hub-button"
import { useIdentity } from "@/lib/auth/use-identity"
import { useSignOut } from "@/lib/auth/use-sign-out"

/**
 * Deliberately not `SidebarTrigger`: that primitive hard-codes a panel-toggle
 * glyph as its JSX children, which a caller cannot override. The design
 * reference calls for a hamburger, so this drives `toggleSidebar` itself.
 */
function MenuButton() {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label="Open menu"
      // The permanent sidebar takes over at lg, so the trigger retires there.
      className="size-9 shrink-0 rounded border-[#E4E9EF] text-[#17191C] transition-transform duration-150 ease-out-quint hover:bg-[#F4F6F9] active:scale-97 motion-reduce:transition-none lg:hidden"
      onClick={toggleSidebar}
    >
      <RiMenuLine className="size-4" />
    </Button>
  )
}

/**
 * The account control. It was previously a static avatar-plus-name block —
 * the one thing on the page that looks pressable and was not. Sign out lived
 * only in the sidebar footer, which is off-canvas on a phone, so signing out
 * on mobile meant opening the nav drawer first.
 */
function AccountMenu({ profileHref }: { profileHref: string }) {
  const { name, email, avatarUrl, subtitle, roleLabel, loading } = useIdentity()
  const { signOut, signingOut } = useSignOut()

  if (loading) {
    return (
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8.5 rounded-full" />
        <div className="hidden gap-1.5 lg:grid">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // A raw button rather than ui/button: none of that component's
        // variants describe a 34px-tall identity chip, and every one of them
        // would have to be undone.
        className="group flex items-center gap-2.5 rounded-md py-1 pr-1.5 pl-1 transition-[transform,background-color] duration-150 ease-out-quint hover:bg-[#F4F6F9] focus-visible:ring-2 focus-visible:ring-[#17191C]/25 focus-visible:outline-none active:scale-97 motion-reduce:transition-none"
        aria-label={`Account menu for ${name}`}
      >
        <UserAvatar name={name} avatarUrl={avatarUrl} className="size-8.5" />
        {/* Per the design reference the identity text drops on narrow screens
            and the avatar carries it alone. The second line is the person's
            designation rather than their email: the email is one press away
            in the menu, and on a payroll system knowing you are signed in as
            Finance Officer is what actually prevents a mistake. */}
        <div className="hidden max-w-40 text-left leading-tight lg:block">
          <div className="truncate text-[13px] font-semibold">{name}</div>
          <div className="truncate text-[11px] text-[#5F6B7C]">{subtitle}</div>
        </div>
        <RiArrowDownSLine
          aria-hidden="true"
          className="hidden size-4 text-[#8A94A3] transition-transform duration-150 ease-out-quint group-data-popup-open:rotate-180 motion-reduce:transition-none lg:block"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-64 p-1.5">
        <div className="flex items-center gap-2.5 px-1.5 py-2">
          <UserAvatar name={name} avatarUrl={avatarUrl} className="size-9" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold">{name}</div>
            <div className="truncate text-[11.5px] text-[#5F6B7C]">{email}</div>
          </div>
        </div>
        <div className="px-1.5 pb-2">
          <span className="inline-flex items-center rounded bg-[#F1F4F8] px-2 py-0.5 text-[10.5px] font-bold tracking-wide text-[#3F4A59] uppercase">
            {roleLabel}
          </span>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          render={<Link href={profileHref} />}
          className="gap-2 px-2 py-2 text-[13px] font-medium"
        >
          <RiUser3Line className="size-4 text-[#5F6B7C]" />
          My profile
        </DropdownMenuItem>

        <DropdownMenuItem
          variant="destructive"
          disabled={signingOut}
          // closeOnClick would unmount the item mid-request and take the
          // spinner with it; the redirect is what closes this menu.
          closeOnClick={false}
          onClick={signOut}
          className="gap-2 px-2 py-2 text-[13px] font-medium"
        >
          {signingOut ? (
            <RiLoader4Line className="size-4 animate-spin" />
          ) : (
            <RiLogoutBoxRLine className="size-4" />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Header({ profileHref }: { profileHref: string }) {
  return (
    <header className="flex h-15 items-center gap-4 border-b border-[#E4E9EF] bg-white px-4 sm:px-7">
      <MenuButton />
      {/* Do not change the outer gap — the grouping div below is what keeps
          the avatar block from moving when the help control is absent. The
          `?` sits left of the bell: the bell is the older, more frequently
          used control and should not move. HelpTrigger renders nothing outside
          the accounting section, so the header keeps its current shape
          everywhere else. */}
      <div className="ml-auto flex items-center gap-3 sm:gap-4.5">
        <div className="flex items-center gap-2">
          <HelpTrigger />
          <NotificationBell />
          <SalesHubButton />
          <BackToDashboardButton />
        </div>
        <AccountMenu profileHref={profileHref} />
      </div>
    </header>
  )
}
