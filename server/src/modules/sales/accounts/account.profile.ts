import prisma from "../../../config/prisma"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { ACCOUNT_NOT_VISIBLE, canManageAccount, employeeIdFor, requireAccountVisible } from "../sales.access"
import type { AccountProfile, ProfileQuestionView } from "../sales.types"
import {
  answerText, checkAnswer, PROFILE_GROUPS, PROFILE_QUESTIONS, QUESTION_BY_KEY, type ProfileQuestion,
} from "./account.profile.questions"
import type { UpdateAccountProfileBody } from "./account.profile.validators"

export const MAX_CUSTOM_QUESTIONS = 30

const CANNOT_CHANGE =
  "You can view this Sales Account, but only its owner, collaborators, or a Sales Admin can change its company profile"
const NOT_ON_ACCOUNT = "That question is not on this account."

type AnswerRow = {
  id: string
  questionKey: string | null
  customQuestion: string | null
  answer: string
  detail: string | null
  updatedBy: string
  updatedAt: Date
}

/** The History label for one question: "Company profile: Does the company have branches?" */
const label = (text: string) => `Company profile: ${text}`

async function namesFor(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, displayName: true, email: true, employee: { select: { fullName: true } } },
  })
  return new Map(users.map((u) => [u.id, u.employee?.fullName ?? u.displayName ?? u.email]))
}

function viewOf(q: ProfileQuestion, row: AnswerRow | undefined, names: Map<string, string>): ProfileQuestionView {
  return {
    key: q.key,
    text: q.text,
    type: q.type,
    detailLabel: q.detailLabel ?? null,
    options: q.options ? [...q.options] : null,
    answer: row?.answer ?? null,
    detail: row?.detail ?? null,
    answeredByName: row ? (names.get(row.updatedBy) ?? null) : null,
    answeredAt: row ? row.updatedAt.toISOString() : null,
  }
}

async function accountFor(client: Pick<typeof prisma, "salesAccount">, accountId: string) {
  const account = await client.salesAccount.findUnique({
    where: { id: accountId },
    select: { ownerEmployeeId: true, assignments: { select: { employeeId: true } } },
  })
  if (!account) throw new AppError(404, ACCOUNT_NOT_VISIBLE)
  return account
}

/**
 * The Company profile: every ready-made question with its answer (or none),
 * and the account's own questions. Anyone who may see the account may read it.
 * The counts are of ready-made questions only, so "12 of 21" never mixes in an
 * account's own extras.
 */
export async function getAccountProfile(accountId: string, actor: AccessTokenPayload): Promise<AccountProfile> {
  const [, employeeId] = await Promise.all([requireAccountVisible(accountId, actor), employeeIdFor(actor)])
  const account = await accountFor(prisma, accountId)
  const rows = (await prisma.salesAccountAnswer.findMany({
    where: { salesAccountId: accountId },
    orderBy: { createdAt: "asc" },
  })) as AnswerRow[]
  const names = await namesFor(rows.map((r) => r.updatedBy))
  const byKey = new Map(rows.filter((r) => r.questionKey).map((r) => [r.questionKey!, r]))

  const groups = PROFILE_GROUPS.map((group) => ({
    key: group.key,
    title: group.title,
    questions: PROFILE_QUESTIONS.filter((q) => q.group === group.key).map((q) => viewOf(q, byKey.get(q.key), names)),
  }))
  return {
    groups,
    custom: rows
      .filter((r) => !r.questionKey)
      .map((r) => ({
        id: r.id,
        question: r.customQuestion ?? "",
        answer: r.answer,
        answeredByName: names.get(r.updatedBy) ?? null,
        answeredAt: r.updatedAt.toISOString(),
      })),
    answered: groups.reduce((n, g) => n + g.questions.filter((q) => q.answer !== null).length, 0),
    total: PROFILE_QUESTIONS.length,
    canManage: canManageAccount(
      actor, employeeId, account.ownerEmployeeId, account.assignments.map((a) => a.employeeId),
    ),
  }
}

/**
 * Saves only what changed, in one transaction, and writes one History row
 * that names each question in words. The write gate is read fresh inside the
 * transaction, so a stale page cannot get past it. A change that turns out to
 * be no change (same answer, or clearing an answer that was never given)
 * writes nothing and makes no History row.
 */
export async function updateAccountProfile(
  accountId: string,
  body: UpdateAccountProfileBody,
  actor: AccessTokenPayload,
): Promise<AccountProfile> {
  const employeeId = await employeeIdFor(actor)

  await prisma.$transaction(async (tx) => {
    const account = await accountFor(tx as typeof prisma, accountId)
    if (!canManageAccount(actor, employeeId, account.ownerEmployeeId, account.assignments.map((a) => a.employeeId))) {
      throw new AppError(403, CANNOT_CHANGE)
    }

    const rows = (await tx.salesAccountAnswer.findMany({ where: { salesAccountId: accountId } })) as AnswerRow[]
    const byKey = new Map(rows.filter((r) => r.questionKey).map((r) => [r.questionKey!, r]))
    const customById = new Map(rows.filter((r) => !r.questionKey).map((r) => [r.id, r]))
    const before: Record<string, string> = {}
    const after: Record<string, string | null> = {}

    for (const [key, value] of Object.entries(body.answers ?? {})) {
      const q = QUESTION_BY_KEY.get(key)
      if (!q) throw new AppError(400, `"${key}" is not a question on the company profile.`)
      const existing = byKey.get(key)

      if (value === null) {
        if (!existing) continue
        await tx.salesAccountAnswer.delete({ where: { id: existing.id } })
        before[label(q.text)] = answerText(q, existing.answer, existing.detail)
        after[label(q.text)] = null
        continue
      }

      const next = checkAnswer(q, value)
      if (existing && existing.answer === next.answer && (existing.detail ?? null) === next.detail) continue
      if (existing) {
        await tx.salesAccountAnswer.update({
          where: { id: existing.id },
          data: { answer: next.answer, detail: next.detail, updatedBy: actor.sub },
        })
        before[label(q.text)] = answerText(q, existing.answer, existing.detail)
      } else {
        await tx.salesAccountAnswer.create({
          data: { salesAccountId: accountId, questionKey: key, answer: next.answer, detail: next.detail, updatedBy: actor.sub },
        })
      }
      after[label(q.text)] = answerText(q, next.answer, next.detail)
    }

    const custom = body.custom ?? {}
    for (const id of custom.remove ?? []) {
      const existing = customById.get(id)
      if (!existing) throw new AppError(404, NOT_ON_ACCOUNT)
      await tx.salesAccountAnswer.delete({ where: { id } })
      customById.delete(id)
      before[label(existing.customQuestion ?? "")] = existing.answer
      after[label(existing.customQuestion ?? "")] = null
    }
    for (const item of custom.update ?? []) {
      const existing = customById.get(item.id)
      if (!existing) throw new AppError(404, NOT_ON_ACCOUNT)
      if (existing.customQuestion === item.question && existing.answer === item.answer) continue
      await tx.salesAccountAnswer.update({
        where: { id: item.id },
        data: { customQuestion: item.question, answer: item.answer, updatedBy: actor.sub },
      })
      before[label(existing.customQuestion ?? "")] = existing.answer
      after[label(item.question)] = item.answer
    }
    const added = custom.add ?? []
    if (customById.size + added.length > MAX_CUSTOM_QUESTIONS) {
      throw new AppError(400, `An account can have up to ${MAX_CUSTOM_QUESTIONS} of its own questions.`)
    }
    for (const item of added) {
      await tx.salesAccountAnswer.create({
        data: { salesAccountId: accountId, customQuestion: item.question, answer: item.answer, updatedBy: actor.sub },
      })
      after[label(item.question)] = item.answer
    }

    if (Object.keys(after).length > 0) {
      await writeAudit(tx, {
        entity: "SALES_ACCOUNT", entityId: accountId, action: "UPDATE", changedBy: actor.sub,
        ...(Object.keys(before).length > 0 ? { before } : {}),
        after,
      })
    }
  })

  return getAccountProfile(accountId, actor)
}
