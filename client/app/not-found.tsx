import type { Metadata } from "next"

import { LostCompass } from "@/components/not-found/lost-compass"
import { NotFoundActions } from "@/components/not-found/not-found-actions"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Heading } from "@/components/ds/heading"

export const metadata: Metadata = {
  title: "Page not found · byteSpate",
  description: "That address does not match any page in this workspace.",
}

/**
 * The app-wide 404.
 *
 * `app/not-found.tsx` catches two different things: an unmatched URL anywhere
 * in the app, and any `notFound()` thrown inside a route segment. Both land
 * here, which is why the copy names the address rather than the feature — it
 * cannot know which page the reader was aiming for.
 *
 * Built on shadcn's `Empty`, the registry's own primitive for this shape.
 * There is no 404 block in the shadcn registry; `Empty` is what it gives you,
 * and it arrives in the `base-nova` style the rest of the app is drawn in.
 *
 * Motion is this project's `.rise-in` from globals.css rather than a
 * `tw-animate-css` utility: it already carries the reduced-motion fallback
 * (the fade survives, the movement goes) instead of needing `motion-reduce:`
 * on every element. Delays step by 40-60ms — long enough to read as a
 * cascade, short enough that the last element is in place inside 300ms, so
 * nobody waits on the buttons.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center px-6 py-16">
      <Empty className="max-w-md border-0">
        <EmptyHeader>
          <LostCompass />

          {/* EmptyTitle renders a div, so the real page heading is nested inside it.
              A 404 with no heading is a 404 a screen-reader user has to infer. */}
          <EmptyTitle className="rise-in" style={{ animationDelay: "180ms" }}>
            <Heading level="page">Page not found</Heading>
          </EmptyTitle>

          <EmptyDescription className="rise-in" style={{ animationDelay: "220ms" }}>
            That address does not match any page in this workspace. It may have
            been renamed, or the link that brought you here may be out of date.
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent className="rise-in mt-1" style={{ animationDelay: "270ms" }}>
          <NotFoundActions />
        </EmptyContent>
      </Empty>
    </main>
  )
}
