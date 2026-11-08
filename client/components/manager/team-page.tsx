"use client"

import { Img } from "@/components/ds/img"
import { useMemo } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"

import { getMyProfile, listEmployees } from "@/lib/api/employees"
import { useSession } from "@/lib/auth/session-context"
import { initialsFrom } from "@/components/profile/avatar-upload"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Heading } from "@/components/ds/heading"

/**
 * A manager's direct reports, linking into the detail page.
 *
 * Reads the same widened list endpoint everything else does. Membership comes
 * from `work.reportingManager.id`, which the payload carries for every row —
 * not from which groups the projection happens to include. The two agree
 * today, but the reporting line is the actual question being asked, and asking
 * it directly is what keeps this correct if the tier rules ever move.
 */
export function ManagerTeamPage() {
  const { accessToken, status: sessionStatus } = useSession()
  const enabled = sessionStatus === "authenticated" && !!accessToken

  const meQuery = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => getMyProfile(accessToken!),
    enabled,
  })

  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: () => listEmployees(accessToken!),
    enabled,
  })

  const myEmployeeId = meQuery.data?.employee?.id ?? null

  const reports = useMemo(() => {
    if (myEmployeeId === null) return []
    return (employeesQuery.data ?? []).filter(
      (e) => e.work.reportingManager?.id === myEmployeeId
    )
  }, [employeesQuery.data, myEmployeeId])

  const loading = sessionStatus === "loading" || meQuery.isPending || employeesQuery.isPending

  return (
    <>
      <div className="pt-7 pb-5.5">
        <div className="mb-1.5 text-[11.5px] font-bold tracking-[1.1px] text-[#7A8698] uppercase">
          Workspace
        </div>
        <Heading level="page" className="mb-1">My team</Heading>
        <div className="text-[13px] text-[#7A8698]">The people who report to you</div>
      </div>

      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : employeesQuery.isError || meQuery.isError ? (
        <div className="rounded-md border border-[#E4E9EF] bg-white p-5.5 text-[13px] text-[#B03A3A]">
          Failed to load your team.{" "}
          <Button variant="link" className="h-auto p-0 font-semibold underline" onClick={() => employeesQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : reports.length === 0 ? (
        <p className="text-[13px] text-[#A5AFBE]">Nobody reports to you yet.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {reports.map((e) => (
            <div
              key={e.id}
              className="flex flex-col gap-3 rounded-md border border-[#E4E9EF] bg-white px-4 py-3.5"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#EFF2F6]">
                  {e.work.avatarUrl ? (
                    <Img src={e.work.avatarUrl} alt="" width={44} height={44} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[13px] font-bold text-[#55657A]">
                      {initialsFrom(e.work.fullName)}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">{e.work.fullName}</div>
                  <div className="truncate text-[12px] text-[#7A8698]">{e.work.designation}</div>
                  <div className="truncate text-[11.5px] text-[#A5AFBE]">
                    {e.work.department.name}
                  </div>
                </div>
              </div>
              {/* A named action rather than a card-sized hit area: it says what
                  happens, and it gives the row one obvious target instead of
                  making the whole card secretly clickable. */}
              <Link
                href={`/manager/team/${e.id}`}
                className="rounded-md border border-[#E4E9EF] px-2.5 py-1 text-center text-[12.5px] font-semibold hover:border-[#C6CCD3]"
              >
                View profile
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
