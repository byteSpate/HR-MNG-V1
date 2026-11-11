/**
 * The Leave report on the Reports page: every leave request that touches a
 * date range, with the days that fall inside that range.
 *
 * A request from 30 January to 3 February shows in both the January and the
 * February report, and each counts only its own days. Days are counted the
 * same way as everywhere else (`countChargedDays`): weekly off days and
 * holidays are left out unless the leave type counts them, and half days
 * count as 0.5.
 */

import type { NextFunction, Request, Response } from "express"
import { z } from "zod"

import prisma from "../../config/prisma"
import type { Prisma } from "../../generated/prisma/client"
import { longDate } from "../../utils/dates"
import { parseReportFormat, resolveReportRange, sendReport } from "../../utils/export/export.report"
import type { ExportSpec } from "../../utils/export/export.types"
import { loadLeaveCalendar } from "./leave.calendar"
import { countChargedDays, type LeaveCalendar, type LeaveSessions } from "./leave.dates"

const STATUS_LABEL = {
  PENDING: "Waiting",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
} as const

type Status = keyof typeof STATUS_LABEL

const query = z.object({
  from: z.string({ message: "Pick a From date." }),
  to: z.string({ message: "Pick a To date." }),
  status: z.enum(Object.keys(STATUS_LABEL) as [Status, ...Status[]], { message: "Pick a status from the list." }).optional(),
  leaveTypeId: z.string().min(1).optional(),
  format: z.string().optional(),
})

interface Ranged extends LeaveSessions {
  startDate: Date
  endDate: Date
}

/**
 * Charged days of one request that fall inside [start, end]. A half day at
 * an edge counts only when that edge is inside the range: a cut edge is a
 * whole day of the range, not the request's half.
 */
export function daysInRange(
  request: Ranged, countsHolidays: boolean, start: Date, end: Date, calendar: LeaveCalendar,
): number {
  const cutStart = request.startDate.getTime() < start.getTime()
  const cutEnd = request.endDate.getTime() > end.getTime()
  const from = cutStart ? start : request.startDate
  const to = cutEnd ? end : request.endDate
  if (from.getTime() > to.getTime()) return 0
  return countChargedDays(
    from,
    to,
    {
      startSession: cutStart ? "FIRST_HALF" : request.startSession,
      endSession: cutEnd ? "SECOND_HALF" : request.endSession,
    },
    { countsHolidays, calendar },
  )
}

export async function leaveReportHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = query.parse(req.query)
    const format = parseReportFormat(q.format)
    const { start, end } = resolveReportRange(q.from, q.to)

    const where: Prisma.LeaveRequestWhereInput = {
      startDate: { lte: end },
      endDate: { gte: start },
      ...(q.status ? { status: q.status } : {}),
      ...(q.leaveTypeId ? { leaveTypeId: q.leaveTypeId } : {}),
    }
    const [requests, calendar] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          leaveType: { select: { name: true, isPaid: true, countsHolidays: true } },
          employee: { select: { employeeCode: true, fullName: true, department: { select: { name: true } } } },
        },
        orderBy: [{ startDate: "asc" }, { employee: { fullName: "asc" } }],
      }),
      loadLeaveCalendar(start, end),
    ])

    const notes = [`${longDate(start)} to ${longDate(end)}`]
    if (q.status) notes.push(STATUS_LABEL[q.status])
    if (q.leaveTypeId) {
      const type = await prisma.leaveType.findUnique({ where: { id: q.leaveTypeId }, select: { name: true } })
      notes.push(type?.name ?? "Leave type not found")
    }

    let approved = 0
    let waiting = 0
    let unpaidApproved = 0
    const rows = requests.map((r) => {
      const days = daysInRange(r, r.leaveType.countsHolidays, start, end, calendar)
      if (r.status === "APPROVED") {
        approved += days
        if (!r.leaveType.isPaid) unpaidApproved += days
      }
      if (r.status === "PENDING") waiting += days
      return [
        r.employee.employeeCode,
        r.employee.fullName,
        r.employee.department.name,
        r.leaveType.name,
        r.leaveType.isPaid ? "Paid" : "Unpaid",
        r.startDate,
        r.endDate,
        days,
        STATUS_LABEL[r.status as Status],
        r.createdAt,
        r.decidedAt,
        r.reason,
        r.decisionNote,
      ]
    })

    const spec: ExportSpec = {
      title: "Leave report",
      filterNote: notes.join(" · "),
      columns: [
        { header: "employeeCode", pdfHeader: "Code", type: "text", inPdf: true },
        { header: "employee", pdfHeader: "Name", type: "text", inPdf: true },
        { header: "department", pdfHeader: "Department", type: "text" },
        { header: "leaveType", pdfHeader: "Leave type", type: "text", inPdf: true },
        { header: "paid", pdfHeader: "Paid", type: "text" },
        { header: "from", pdfHeader: "From", type: "date", inPdf: true },
        { header: "to", pdfHeader: "To", type: "date", inPdf: true },
        { header: "daysInRange", pdfHeader: "Days in range", type: "decimal", decimals: 1, inPdf: true },
        { header: "status", pdfHeader: "Status", type: "text", inPdf: true },
        { header: "sentOn", pdfHeader: "Sent on", type: "date" },
        { header: "decidedOn", pdfHeader: "Decided on", type: "date" },
        { header: "reason", pdfHeader: "Reason", type: "text" },
        { header: "decisionNote", pdfHeader: "Decision note", type: "text" },
      ],
      rows,
    }

    await sendReport({
      res, spec, format, baseName: "leave-report", actor: req.user!, list: "LEAVE_REPORT",
      filter: { from: q.from, to: q.to, status: q.status ?? null, leaveTypeId: q.leaveTypeId ?? null },
      summary: [
        { label: "Requests", value: String(rows.length) },
        { label: "Approved days", value: String(approved) },
        { label: "Waiting days", value: String(waiting) },
        { label: "Unpaid days approved", value: String(unpaidApproved) },
      ],
    })
  } catch (err) {
    next(err)
  }
}
