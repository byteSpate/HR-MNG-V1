import type { Metadata } from "next"
import { Public_Sans, Sora } from "next/font/google"

import { cn } from "@/lib/utils"
import { SalesShell } from "@/components/sales/shared/sales-shell"

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
})

const sora = Sora({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-heading",
})

export const metadata: Metadata = {
  title: "Techno Sales Hub | byteSpate",
}

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        publicSans.variable,
        sora.variable,
        "font-sans flex min-h-screen w-full bg-surface-hover text-ink-body"
      )}
    >
      <SalesShell>{children}</SalesShell>
    </div>
  )
}
