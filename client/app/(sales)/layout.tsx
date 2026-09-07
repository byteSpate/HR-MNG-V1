import type { Metadata } from "next"
import { Public_Sans, Sora } from "next/font/google"

import { cn } from "@/lib/utils"
import { SalesShell } from "@/components/sales/sales-shell"

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
  title: "Sales Hub | byteSpate",
}

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        publicSans.variable,
        sora.variable,
        "font-sans flex min-h-screen w-full bg-[#F4F6F9] text-[#1C2733]"
      )}
    >
      <SalesShell>{children}</SalesShell>
    </div>
  )
}
