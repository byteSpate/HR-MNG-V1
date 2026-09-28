"use client"

import type { ComponentType } from "react"
import {
  RiBuilding2Line,
  RiCalendarCheckLine,
  RiComputerLine,
  RiExchangeDollarLine,
  RiLockLine,
  RiPercentLine,
  RiPriceTag3Line,
  RiTimeLine,
  type RemixiconComponentType,
} from "@remixicon/react"

import { PageHeader } from "@/components/dashboard/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Role } from "@/lib/api/types"
import { useSession } from "@/lib/auth/session-context"
import { AssetCategoriesPanel } from "./asset-categories-panel"
import { CostCategoriesPanel } from "./cost-categories-panel"
import { DepartmentsPanel } from "./departments-panel"
import { ExchangeRatesPanel } from "./exchange-rates-panel"
import { LeaveTypesPanel } from "./leave-types-panel"
import { ShiftsPanel } from "./shifts-panel"
import { VatCodesPanel } from "./vat-codes-panel"
import { TONE } from "@/components/dashboard/record-kit"

interface SettingsTab {
  value: string
  label: string
  icon: RemixiconComponentType
  /** Mirrors the requireRole gate on the routes this panel calls. */
  roles: Role[]
  Panel: ComponentType<{ accessToken: string }>
}

/**
 * The single place the role matrix lives.
 *
 * This is UX only. Every gate is enforced server-side by `requireRole`, so a
 * role that reaches a hidden panel gets a 403 from the API rather than a write.
 * Keeping it in one table means there is one place for it to be wrong, instead
 * of one per route file.
 */
const TABS: SettingsTab[] = [
  {
    value: "departments",
    label: "Departments",
    icon: RiBuilding2Line,
    roles: ["SUPER_ADMIN", "HR_ADMIN"],
    Panel: DepartmentsPanel,
  },
  {
    value: "shifts",
    label: "Shifts",
    icon: RiTimeLine,
    roles: ["SUPER_ADMIN", "HR_ADMIN"],
    Panel: ShiftsPanel,
  },
  {
    value: "leave-types",
    label: "Leave types",
    icon: RiCalendarCheckLine,
    roles: ["SUPER_ADMIN", "HR_ADMIN"],
    Panel: LeaveTypesPanel,
  },
  {
    value: "asset-categories",
    label: "Asset categories",
    icon: RiComputerLine,
    roles: ["SUPER_ADMIN", "HR_ADMIN"],
    Panel: AssetCategoriesPanel,
  },
  // Finance, not HR. Cost categories are the one reference table HR does not
  // own, matching the WRITE_ROLES gate on /api/costs/categories.
  {
    value: "cost-categories",
    label: "Cost categories",
    icon: RiPriceTag3Line,
    roles: ["SUPER_ADMIN", "FINANCE_OFFICER"],
    Panel: CostCategoriesPanel,
  },
  {
    value: "exchange-rates",
    label: "Exchange rates",
    icon: RiExchangeDollarLine,
    roles: ["SUPER_ADMIN", "FINANCE_OFFICER"],
    Panel: ExchangeRatesPanel,
  },
  {
    value: "vat-codes",
    label: "VAT codes",
    icon: RiPercentLine,
    roles: ["SUPER_ADMIN", "FINANCE_OFFICER"],
    Panel: VatCodesPanel,
  },
]

export function SettingsPage() {
  const { user, accessToken } = useSession()

  if (!user || !accessToken) return null

  const visible = TABS.filter((tab) => tab.roles.includes(user.role))

  if (visible.length === 0) {
    // Unreachable from the nav today. It exists so that adding a role without
    // updating the registry produces a sentence rather than an empty strip.
    return (
      <>
        <PageHeader
          kicker="Administration"
          title="Settings"
          sub="Reference data the rest of the system is built from."
        />
        <div className="rounded-md border border-[#E4E9EF] bg-white px-5 py-12 text-center">
          <span className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md bg-[#F1F4F8] text-[#5F6B7C]">
            <RiLockLine className="size-5" aria-hidden />
          </span>
          <div className="text-[13.5px] font-bold">Nothing here for your role</div>
          <p className={`mx-auto mt-1 max-w-[44ch] text-[12.5px] leading-relaxed ${TONE.muted}`}>
            Settings holds the reference tables that HR and finance own. Ask an administrator if you
            need a change made to one.
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        kicker="Administration"
        title="Settings"
        sub="Reference data the rest of the system is built from."
      />

      {/*
        A horizontal strip, not a left rail. The dashboard already owns a
        vertical nav down the left edge, and a second one inside the page reads
        as a competing hierarchy rather than a section switcher.

        Underline tabs rather than the filled pills the sidebar uses, so the two
        navigations do not share an active treatment either.
      */}
      <Tabs defaultValue={visible[0].value} className="gap-0">
        <TabsList
          variant="line"
          /* `h-auto!` is load-bearing: the primitive pins a horizontal list to
             `h-8` through `group-data-horizontal/tabs:h-8`, which outranks a
             plain utility on specificity. */
          className="h-auto! w-full justify-start gap-6 rounded-none border-b border-[#E4E9EF] bg-transparent p-0"
        >
          {visible.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              /* `after:hidden` drops the primitive's own indicator; this uses a
                 bottom border so the active tab sits on the list's hairline.
                 The colour is set on `border-b` alone, because `data-active:
                 border-*` would paint all four sides of the trigger. */
              className="h-auto flex-none gap-2 rounded-none border-b-2 border-transparent px-0 pt-0 pb-2.5 text-[13px] font-semibold text-[#5F6B7C] transition-colors after:hidden hover:text-[#1C2733] data-active:border-b-[#17191C] data-active:bg-transparent data-active:text-[#1C2733]"
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {visible.map(({ value, Panel }) => (
          <TabsContent
            key={value}
            value={value}
            /* A short fade marks that the panel below the strip changed. It is
               the only motion on this screen. */
            className="min-w-0 pt-6 animate-in fade-in-0 duration-150 motion-reduce:animate-none"
          >
            <Panel accessToken={accessToken} />
          </TabsContent>
        ))}
      </Tabs>
    </>
  )
}
