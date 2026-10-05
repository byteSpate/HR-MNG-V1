import type { Metadata } from "next"
import { cookies } from "next/headers"
import Link from "next/link"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { AUTH_LINK } from "../auth-form-ui"
import { AuthShell } from "../auth-shell"
import { AdminLoginForm } from "./admin-login-form"
import { LoginGate } from "./login-gate"
import { StaffLoginForm } from "./staff-login-form"

export const metadata: Metadata = {
  title: "Sign in | byteSpate",
}

export default async function LoginPage() {
  // The refresh cookie is httpOnly, so only the server can tell whether there is
  // a session worth checking. See `loginScreen`.
  const hasRefreshCookie = (await cookies()).has("refreshToken")

  return (
    <LoginGate hasRefreshCookie={hasRefreshCookie}>
      <AuthShell
        title="Welcome back"
        subtitle="Sign in to your byteSpate workspace."
        footer={
          <>
            Access is provisioned by your HR admin.{" "}
            <a href="#" className={AUTH_LINK}>
              Contact them
            </a>{" "}
            to get set up.
          </>
        }
      >
        {/* A segmented control, not the page-level underline tabs used inside
            the app: this picks which credential you are signing in with, so
            it should read as a switch rather than as navigation. */}
        <Tabs defaultValue="staff">
          <TabsList className="mb-6 h-auto! w-full gap-1 rounded-lg bg-[#EFF2F6] p-1">
            <TabsTrigger
              value="staff"
              className="h-9 flex-1 rounded-md text-[13px] font-semibold text-[#5F6B7C] after:hidden data-active:bg-white data-active:text-[#17191C] data-active:shadow-[0_1px_2px_rgba(28,39,51,0.10)]"
            >
              Staff
            </TabsTrigger>
            <TabsTrigger
              value="admin"
              className="h-9 flex-1 rounded-md text-[13px] font-semibold text-[#5F6B7C] after:hidden data-active:bg-white data-active:text-[#17191C] data-active:shadow-[0_1px_2px_rgba(28,39,51,0.10)]"
            >
              Administrator
            </TabsTrigger>
          </TabsList>
          <TabsContent value="staff">
            <StaffLoginForm />
          </TabsContent>
          <TabsContent value="admin">
            <AdminLoginForm />
          </TabsContent>
        </Tabs>

        {/*
          Outside the tabs on purpose. Both credentials reset through the same
          route, since the reset link is sent to the email on the account either
          way, and a link that moved when you switched tabs would suggest there
          were two different resets.
        */}
        <p className="mt-5 text-center text-[12px] text-[#5F6B7C]">
          <Link href="/forgot-password" className={AUTH_LINK}>
            Forgot your password?
          </Link>
        </p>
      </AuthShell>
    </LoginGate>
  )
}
