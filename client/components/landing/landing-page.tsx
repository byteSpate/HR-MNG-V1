import Link from "next/link"
import { Public_Sans, Sora } from "next/font/google"

import { cn } from "@/lib/utils"
import { BrandLogo } from "@/components/brand/brand"
import {
  bandStats,
  features,
  footerLinks,
  heroRoles,
  navLinks,
  quotes,
} from "@/components/landing/data"
import { Heading } from "@/components/ds/heading"

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

function countdownToPayday() {
  const target = new Date("2026-08-01T00:00:00").getTime()
  const diff = Math.max(0, target - Date.now())
  const d = Math.floor(diff / 86400000)
  const h = Math.floor((diff % 86400000) / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d}d ${pad(h)}h ${pad(m)}m`
}

// Not wired to any route yet — kept here as a ready-to-mount component.
// Interactive bits from the design (role switcher, feature picker, quote
// rotation, live countdown) are rendered at their default/first state only.
export function LandingPage() {
  const role = heroRoles[0]
  const feature = features[0]
  const quote = quotes[0]

  return (
    <div className={cn(publicSans.variable, sora.variable, "font-sans flex min-h-screen flex-col bg-[#FBFBFC] text-[#17191C]")}>
      <header className="sticky top-0 z-10 border-b border-[#E7E9EC] bg-[#FBFBFC]/92 backdrop-blur-sm">
        <div className="mx-auto flex h-15.5 max-w-290 items-center gap-7 px-7">
          <BrandLogo width={150} />
          <nav className="ml-3 hidden gap-5.5 sm:flex">
            {navLinks.map((link) => (
              <a key={link.label} href={link.href} className="text-[13.5px] font-semibold text-[#55657A]">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <Link href="/login" className="px-3.5 py-2.25 text-[13.5px] font-bold">
              Sign in
            </Link>
            <Link
              href="/employee"
              className="rounded bg-[#17191C] px-4 py-2.25 text-[13.5px] font-bold text-white hover:bg-[#33373D]"
            >
              Get a demo
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-290 grid-cols-1 items-center gap-10 px-5.5 pt-14 pb-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:gap-14 lg:px-7 lg:pt-21 lg:pb-18">
        <div>
          <h1 className="font-heading m-0 text-[38px] leading-[1.04] font-bold tracking-tighter text-balance sm:text-[58px]">
            Payroll that closes itself.
          </h1>
          <p className="mt-5.5 max-w-120 text-[17px] leading-[1.65] text-[#55657A] text-pretty">
            From the moment your team checks in to the second payslips land — attendance, leave, expenses, and
            approvals flow into one payroll run. Nobody chases a spreadsheet again.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/login"
              className="rounded bg-[#17191C] px-6.5 py-3.5 text-[14.5px] font-bold text-white hover:bg-[#33373D]"
            >
              Start free pilot
            </Link>
            <a
              href="#features"
              className="rounded border border-[#D8DCE1] bg-white px-6.5 py-3.5 text-[14.5px] font-bold hover:bg-[#F0F1F3]"
            >
              See the product
            </a>
          </div>
          <div className="mt-10 flex gap-7 border-t border-[#E7E9EC] pt-5.5">
            <div>
              <span className="font-heading text-[19px] font-bold">400+</span>
              <span className="mt-0.5 block text-[12.5px] text-[#8B95A3]">companies</span>
            </div>
            <div>
              <span className="font-heading text-[19px] font-bold">$12.6M</span>
              <span className="mt-0.5 block text-[12.5px] text-[#8B95A3]">paid out this year</span>
            </div>
            <div>
              <span className="font-heading text-[19px] font-bold">2 days</span>
              <span className="mt-0.5 block text-[12.5px] text-[#8B95A3]">median close</span>
            </div>
          </div>
        </div>

        <div className="rounded-md bg-[#0E1012] p-6 text-white shadow-[0_30px_60px_-30px_rgba(0,0,0,0.45)]">
          <div className="mb-3.5 text-[11px] font-bold tracking-[1.2px] text-white/45 uppercase">
            Pick a seat — see your day
          </div>
          <div className="mb-5.5 flex flex-wrap gap-1.5">
            {heroRoles.map((r) => (
              <span
                key={r.label}
                className={cn(
                  "rounded border px-3 py-1.75 text-xs font-bold",
                  r.label === role.label ? "border-white bg-white text-[#17191C]" : "border-white/25 text-white/60"
                )}
              >
                {r.label}
              </span>
            ))}
          </div>
          <div className="font-heading text-[34px] font-bold tracking-tighter">{role.stat}</div>
          <div className="mt-1 text-[13px] text-white/55">{role.statLabel}</div>
          <div className="mt-5 flex flex-col border-t border-white/12">
            {role.actions.map((action) => (
              <div key={action.text} className="flex items-center gap-3 border-b border-white/8 py-3">
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: action.dot }} />
                <span className="flex-1 text-[13.5px]">{action.text}</span>
                <span className="text-[11px] font-bold text-white/45">{action.hint}</span>
              </div>
            ))}
          </div>
          <Link
            href="/employee"
            className="mt-4.5 block rounded bg-white py-2.75 text-center text-[13px] font-bold text-[#17191C] hover:bg-[#D8DCE1]"
          >
            Open this dashboard →
          </Link>
        </div>
      </section>

      <section className="bg-[#0E1012] text-white">
        <div className="mx-auto flex max-w-290 flex-wrap items-center justify-between gap-6 px-7 py-6.5">
          <div className="text-[13px] font-semibold text-white/60">Next payroll run across byteSpate</div>
          <div className="flex items-baseline gap-5.5">
            <div className="font-heading text-2xl font-bold tracking-wide tabular-nums">{countdownToPayday()}</div>
            <div className="text-xs text-white/45">until Aug 1 · 1,248 payslips queued</div>
          </div>
          <div className="flex items-center gap-2 text-[12.5px] font-bold text-[#7BC894]">
            <span className="inline-block size-1.75 rounded-full bg-[#7BC894]" />
            All systems reconciled
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-290 px-5 py-15 sm:px-7 sm:py-24">
        <div className="mb-11 max-w-155">
          <Heading level="section" className="m-0 text-balance sm:text-4xl">
            One system between check-in and payslip
          </Heading>
        </div>
        <div className="grid grid-cols-1 items-start gap-[18px] lg:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)] lg:gap-10">
          <div className="flex flex-col gap-1">
            {features.map((f, i) => (
              <div
                key={f.title}
                className={cn(
                  "flex items-center gap-3.5 rounded px-4 py-3.5",
                  f.title === feature.title ? "bg-[#17191C] text-white" : "text-[#17191C]"
                )}
              >
                <span
                  className="font-heading text-xs font-bold"
                  style={{ color: f.title === feature.title ? "rgba(255,255,255,0.5)" : "#A8B0BA" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[15px] font-bold">{f.title}</span>
              </div>
            ))}
          </div>
          <div className="flex min-h-80 flex-col rounded-md border border-[#E7E9EC] bg-white p-8.5">
            <div className="text-[11px] font-bold tracking-[1.2px] text-[#8B95A3] uppercase">{feature.kicker}</div>
            <div className="font-heading mt-2.5 text-[22px] font-bold tracking-tight">{feature.title}</div>
            <p className="mt-3 text-[14.5px] leading-[1.7] text-[#55657A] text-pretty">{feature.body}</p>
            <div className="mt-5.5 flex flex-col gap-2.5">
              {feature.points.map((point) => (
                <div key={point} className="flex items-center gap-2.5 text-[13.5px] font-semibold">
                  <span className="grid size-4 shrink-0 place-items-center rounded bg-[#17191C] text-[10px] text-white">
                    ✓
                  </span>
                  {point}
                </div>
              ))}
            </div>
            <div className="mt-auto pt-6 text-[13px] font-bold">
              <Link href="/employee">See it in the dashboard →</Link>
            </div>
          </div>
        </div>
      </section>

      <section id="numbers" className="bg-[#0E1012] text-white">
        <div className="mx-auto max-w-290 px-7 py-18">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-8">
            {bandStats.map((stat) => (
              <div key={stat.label} className="border-l border-white/15 pl-5">
                <div className="font-heading text-[38px] font-bold tracking-tighter">{stat.value}</div>
                <div className="mt-1.5 text-[13px] leading-snug text-white/55">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="voices" className="border-b border-[#E7E9EC] bg-white">
        <div className="mx-auto max-w-200 px-5 py-15 sm:px-7 sm:py-24 text-center">
          {/* The height reservation stops the page jumping as quotes rotate.
              At 19px a quote is taller than 110px anyway, so on a phone it
              would only add dead space. */}
          <div className="min-h-0 text-[19px] leading-[1.5] font-semibold tracking-tight text-balance sm:min-h-27.5 sm:text-2xl">
            &ldquo;{quote.text}&rdquo;
          </div>
          <div className="mt-5 text-[13px] text-[#55657A]">
            <strong className="text-[#17191C]">{quote.who}</strong> · {quote.org}
          </div>
          <div className="mt-7 flex justify-center gap-2">
            {quotes.map((q) => (
              <span
                key={q.who}
                className={cn("h-1.75 rounded", q.who === quote.who ? "w-5.5 bg-[#17191C]" : "w-1.75 bg-[#D8DCE1]")}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-290 px-5 py-15 sm:px-7 sm:py-24 text-center">
        <h2 className="font-heading m-0 text-[30px] font-bold tracking-tighter sm:text-[40px]">
          Close your next payroll in two days.
        </h2>
        <p className="mx-auto mt-4 max-w-110 text-[15px] leading-relaxed text-[#55657A]">
          30-day pilot on your real data. We migrate everything; you keep your close date.
        </p>
        <div className="mt-7.5 flex justify-center gap-3">
          <Link
            href="/login"
            className="rounded bg-[#17191C] px-7 py-3.5 text-[14.5px] font-bold text-white hover:bg-[#33373D]"
          >
            Start free pilot
          </Link>
          <a href="#" className="rounded border border-[#D8DCE1] px-7 py-3.5 text-[14.5px] font-bold hover:bg-[#F0F1F3]">
            Talk to sales
          </a>
        </div>
      </section>

      <footer className="bg-[#0E1012] text-white/60">
        <div className="mx-auto flex max-w-290 flex-wrap items-center justify-between gap-5 px-7 py-9">
          <BrandLogo tone="dark" width={132} />
          <nav className="flex flex-wrap gap-5.5">
            {footerLinks.map((link) => (
              <a key={link.label} href={link.href} className="text-[12.5px] hover:text-white">
                {link.label}
              </a>
            ))}
          </nav>
          <div className="text-xs">© 2026 byteSpate</div>
        </div>
      </footer>
    </div>
  )
}
