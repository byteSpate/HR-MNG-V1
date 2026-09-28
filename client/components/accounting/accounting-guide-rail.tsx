"use client"

import * as React from "react"

export interface RailItem {
  id: string
  number: string
  label: string
}

/**
 * The sticky "where am I" rail beside the guide's prose.
 *
 * Not a table of contents in the sense the page's structure decision
 * rejected — the guide is still one story, read top to bottom, and this
 * doesn't reorder or fragment that. It's wayfinding on a page that got long
 * enough to need it, plus somewhere for the width a 640px prose column
 * doesn't use on an ordinary monitor to go, rather than sitting blank.
 *
 * IntersectionObserver, not scroll-position math: cheaper, and it doesn't
 * fight the browser's own scroll-into-view when a rail link is clicked.
 */
export function GuideRail({ items }: { items: RailItem[] }) {
  const [activeId, setActiveId] = React.useState(items[0]?.id)

  React.useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        // The one nearest the top of the viewport, not just the first in
        // DOM order — two sections can both be "intersecting" on a tall page.
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b))
        setActiveId(top.target.id)
      },
      { rootMargin: "-15% 0px -70% 0px" }
    )
    sections.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [items])

  return (
    <nav aria-label="Sections on this page" className="sticky top-20">
      <ol className="space-y-1 border-l border-[#E4E9EF]">
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className={
                  active
                    ? "-ml-px block border-l-2 border-[#17191C] py-1 pl-3.5 text-[12.5px] font-bold text-[#17191C]"
                    : "-ml-px block border-l-2 border-transparent py-1 pl-3.5 text-[12.5px] text-[#8792A3] hover:text-[#3B4757]"
                }
              >
                {item.number} · {item.label}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
