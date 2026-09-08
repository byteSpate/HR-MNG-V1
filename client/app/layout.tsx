import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { SessionProvider } from "@/lib/auth/session-context";
import { QueryProvider } from "@/lib/query/query-provider";

const geistHeading = Geist({subsets:['latin'],variable:'--font-heading'});

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Neither Geist nor Inter carries Bengali glyphs, so without a real face the
// browser falls back to whatever the OS has (Nirmala UI, Bangla MN, ...) —
// three typefaces with three metrics. next/font/google self-hosts this at
// build time, so it's a local font file, not a runtime request.
const notoBengali = Noto_Sans_Bengali({
  subsets: ["bengali"],
  variable: "--font-bengali",
  display: "swap",
});

export const metadata: Metadata = {
  title: "byteSpate",
  description: "HR & payroll management",
};

// Must be its own export — Next.js 16 ignores `viewport` keys nested inside
// `metadata`, silently, so the mobile layouts below would never engage.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable, geistHeading.variable, notoBengali.variable)}
    >
      {/* suppressHydrationWarning sits on <body> and nowhere else, and it is
          not covering for a render bug of ours. Browser extensions mutate
          <body> before React hydrates — Grammarly writes
          `data-gr-ext-installed` and `data-new-gr-c-s-check-loaded`, password
          managers write their own — and React then reports attributes it
          never put there. The flag is one level deep: it silences the
          mismatch on this element's own attributes only, so a genuine
          mismatch anywhere inside the tree is still reported. */}
      <body suppressHydrationWarning className="min-h-full flex flex-col"><QueryProvider><SessionProvider>{children}</SessionProvider></QueryProvider></body>
    </html>
  );
}
