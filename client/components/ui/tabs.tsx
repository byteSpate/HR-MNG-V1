"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { edgeFades, fadeMask, type EdgeFades } from "@/components/ds/scroll-edges"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  // `max-w-full overflow-x-auto`: triggers are flex items with the default
  // `min-width: auto`, so they refuse to compress below their label and a
  // `w-fit` list simply grows past a narrow viewport (5 tabs on the HR assets
  // page ran to 447px inside 375px). Capping the list and letting it scroll
  // keeps every tab reachable instead of pushing the page sideways.
  // `justify-start`, not `justify-center`: the list is `w-fit`, so when the
  // tabs fit it hugs them and justification is a no-op. When they overflow,
  // centering clips *both* ends and leaves the first tab unreachable.
  "group/tabs-list inline-flex w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  style,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [fades, setFades] = React.useState<EdgeFades>({ start: false, end: false })

  // Soften the ends that are cut off, so it is clear the strip scrolls. Keep
  // the open tab in view, so a link to a far tab does not open on the wrong side.
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const next = edgeFades(el.scrollLeft, el.clientWidth, el.scrollWidth)
      setFades((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
    }
    const reveal = () => {
      const active = el.querySelector<HTMLElement>("[data-active]")
      if (!active) return
      const box = el.getBoundingClientRect()
      const tab = active.getBoundingClientRect()
      if (tab.left < box.left) el.scrollBy({ left: tab.left - box.left - 24, behavior: "smooth" })
      else if (tab.right > box.right) el.scrollBy({ left: tab.right - box.right + 24, behavior: "smooth" })
    }
    reveal()
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    const resize = new ResizeObserver(measure)
    resize.observe(el)
    const mutate = new MutationObserver(() => {
      reveal()
      measure()
    })
    mutate.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-active"] })
    return () => {
      el.removeEventListener("scroll", measure)
      resize.disconnect()
      mutate.disconnect()
    }
  }, [])

  const mask = fadeMask(fades)
  return (
    <TabsPrimitive.List
      ref={ref}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask, ...style } : style}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
