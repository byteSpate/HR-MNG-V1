/**
 * Submitting a weekly report, and reading a kept copy (revision §26.4, §26.17).
 *
 * The same shape as sending meeting minutes, for the same reason: what
 * management read on Saturday must not change under them. Submit renders the
 * week, keeps those exact bytes in the file store, records the copy, and hands
 * the same bytes back.
 *
 * Nothing is marked submitted without a kept copy. The file store is checked
 * before anything is made, and a failed write removes the stored file.
 *
 * The late mark and the first submitted time are written once and never
 * again: a week reopened and submitted a second time keeps both (§26.4).
 */

import { randomUUID } from "node:crypto"

import { env } from "../../config/env"
import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import type { AccessTokenPayload } from "../auth/auth.types"
import { Role, SalesRole } from "../../generated/prisma/client"
import { assertMediaConfigured } from "../media/media.provider"
import { destroyAsset, signedDocumentUrl, uploadBuffer } from "../media/media.service"
import { renderWeeklyPdf, weeklyFileName } from "./weekly.pdf"
import { isLate, weekEndOf } from "./weekly.dates"
import { employeeIdFor } from "./sales.access"
import { loadWeek, weekFrom, writerFor, type WeekQuery } from "./weekly.service"

export const WEEKLY_COPY_NOT_VISIBLE = "That copy does not exist, or is not yours"

/** 15s: a kept copy is fetched on the download path, well under Heroku's 30s limit. */
const FETCH_TIMEOUT_MS = 15_000

export interface WeeklyFile {
  pdf: Buffer
  fileName: string
}

/** Random, because every submit keeps its own copy (§26.17). */
function copyPublicId(reportId: string): string {
  return `sales/weekly/${reportId}/${randomUUID()}`
}

const isAdmin = (actor: AccessTokenPayload) =>
  actor.role === Role.SUPER_ADMIN || actor.salesRole === SalesRole.SALES_ADMIN

/**
 * Renders the week, keeps the copy, and marks the report submitted. The
 * answer is that same file, so the page downloads exactly what was kept.
 */
export async function submitMyWeek(query: WeekQuery, actor: AccessTokenPayload): Promise<WeeklyFile> {
  const employeeId = await writerFor(actor)
  const weekStart = weekFrom(query)

  const report = await prisma.weeklyReport.findUnique({
    where: { employeeId_weekStart: { employeeId, weekStart } },
    select: { id: true, status: true, firstSubmittedAt: true },
  })
  if (!report) {
    throw new AppError(400, "There is nothing in this week to submit yet")
  }
  // Before anything is made: a copy that cannot be kept must not be submitted.
  assertMediaConfigured()

  const week = await loadWeek(employeeId, weekStart, actor)
  const weekEnd = weekEndOf(weekStart)
  const submittedAt = new Date()
  const fileName = weeklyFileName(week.person.fullName, weekStart, weekEnd, env.APP_TIMEZONE)
  const firstTime = report.firstSubmittedAt === null
  const late = firstTime ? isLate(submittedAt, week.deadlineDay) : week.submittedLate

  const pdf = await renderWeeklyPdf({
    fullName: week.person.fullName,
    designation: week.person.designation,
    weekStart,
    weekEnd,
    status: "SUBMITTED",
    submittedLate: late,
    submittedAt,
    // A week sent again after being added to says so, so a manager who read
    // the earlier copy can see that this one is newer (§26.4).
    updatedAt: firstTime ? null : submittedAt,
    counts: week.counts,
    days: week.days,
    companyName: env.COMPANY_NAME,
    timeZone: env.APP_TIMEZONE,
  })

  const asset = await uploadBuffer(pdf, copyPublicId(report.id))
  try {
    await prisma.$transaction(async (tx) => {
      await tx.weeklyReportCopy.create({
        data: {
          weeklyReportId: report.id,
          submittedAt,
          submittedBy: actor.sub,
          fileId: asset.publicId,
          fileName,
        },
      })
      await tx.weeklyReport.update({
        where: { id: report.id },
        data: {
          status: "SUBMITTED",
          lastSubmittedAt: submittedAt,
          // Written once. A reopened week keeps the day it was first sent,
          // and whether that was late.
          ...(firstTime ? { firstSubmittedAt: submittedAt, submittedLate: late } : {}),
        },
      })
      await writeAudit(tx, {
        entity: "WEEKLY_REPORT",
        entityId: report.id,
        action: "SUBMIT",
        changedBy: actor.sub,
        after: { fileName, ...(firstTime ? { late } : {}) },
        note: firstTime ? "Weekly report submitted" : "Weekly report submitted again",
      })
    })
  } catch (err) {
    // Nothing was recorded, so nothing may be kept either.
    await destroyAsset(asset.publicId)
    throw err
  }

  return { pdf, fileName }
}

/** A copy exactly as it was submitted: the writer's own, or any for an admin. */
export async function getWeeklyCopy(copyId: string, actor: AccessTokenPayload): Promise<WeeklyFile> {
  const employeeId = await employeeIdFor(actor)
  const copy = await prisma.weeklyReportCopy.findFirst({
    where: {
      id: copyId,
      ...(isAdmin(actor) ? {} : { weeklyReport: { employeeId: employeeId ?? "__none__" } }),
    },
    select: { id: true, fileId: true, fileName: true },
  })
  if (!copy) throw new AppError(404, WEEKLY_COPY_NOT_VISIBLE)

  const { url } = signedDocumentUrl(copy.fileId, "pdf")
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null)
  if (!res?.ok) {
    throw new AppError(502, "The kept copy could not be fetched from the file store. Try again in a moment.")
  }
  return { pdf: Buffer.from(await res.arrayBuffer()), fileName: copy.fileName }
}
