import { Public_Sans, Sora } from "next/font/google"

import { cn } from "@/lib/utils"

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

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn(publicSans.variable, sora.variable, "font-sans min-h-screen w-full bg-surface-subtle text-ink")}>
      {children}
    </div>
  )
}
