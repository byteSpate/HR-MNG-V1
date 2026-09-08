import prisma from "../../config/prisma"
import { AppError } from "../../middleware/errorHandler"
import { writeAudit } from "../../utils/audit"
import { emitEvent } from "../event/event.emit"
import type { AccessTokenPayload } from "../auth/auth.types"
import type { CreateSalesAccountBody } from "./sales.validators"
import type { AccountHistory, AccountHistoryEntry, SalesAccountSummary } from "./sales.types"
import { EmploymentStatus, SalesRole } from "../../generated/prisma/client"
import {
  canManageAccount,
  employeeIdFor,
  ownedScopeFor,
  requireAccountVisible,
} from "./sales.access"
import {
  canBeAccountOwner,
  canWorkAccounts,
  employmentAllowsSales,
  type SalesStanding,
} from "./sales.eligibility"
import { presentChanges, resolveNames } from "./history.present"

/**
 * How many History rows one read returns.
 *
 * Matches the Timeline's cap. Both feeds grow without bound and both render
 * every row they are given, so neither can be left unlimited; an account
 * worked for a year accumulates thousands of audit rows.
 */
const HISTORY_LIMIT = 100

/**
 * One sentence, used by both paths that can find a clash — the check inside
 * the transaction and the database a moment later. Naming the existing owner
 * is the difference between a dead end and a phone call, so the racing
 * caller must not get a lesser message than everyone else.
 */
function duplicateNameMessage(existingName: string, ownerName: string): string {
  return `"${existingName}" already exists and is owned by ${ownerName}. Talk to them before creating a second one.`
}

/**
 * A Prisma employee row narrowed to the four facts the eligibility rules
 * need. One place to assemble it, so a caller cannot select the columns and
 * then forget to pass one of them through.
 */
function standingOf(employee: {
  employmentStatus: EmploymentStatus
  lastWorkingDay: Date | null
  user: { salesRole: SalesRole | null; isActive: boolean } | null
}): SalesStanding {
  return {
    salesRole: employee.user?.salesRole ?? null,
    employmentStatus: employee.employmentStatus,
    lastWorkingDay: employee.lastWorkingDay,
    // No login row at all is not an active login.
    loginActive: employee.user?.isActive ?? false,
  }
}

function findClash(client: typeof prisma, name: string) {
  return client.salesAccount.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    include: { owner: { select: { fullName: true } } },
  })
}

export async function createSalesAccount(
  body: CreateSalesAccountBody,
  actor: AccessTokenPayload
): Promise<SalesAccountSummary> {
  // Read before the transaction opens: it is a fact about the caller, not
  // about the account being written, and issuing it on the global client
  // from inside the callback would run it outside the transaction anyway.
  const actorEmployeeId = await employeeIdFor(actor)

  try {
    return await prisma.$transaction(async (tx) => {
      // `name @unique` is exact-match only, so the case-insensitive refusal is
      // here rather than in the database.
      const clash = await findClash(tx as typeof prisma, body.name)
      if (clash) {
        throw new AppError(409, duplicateNameMessage(clash.name, clash.owner.fullName))
      }

      const owner = await tx.employee.findUnique({
        where: { id: body.ownerEmployeeId },
        select: {
          id: true,
          fullName: true,
          employmentStatus: true,
          lastWorkingDay: true,
          user: { select: { salesRole: true, isActive: true } },
        },
      })
      if (!owner) {
        throw new AppError(400, "That owner is not an employee")
      }
      // Three ways to be ineligible, and they need three different sentences
      // — "not allowed" would leave a Sales Admin guessing which one applies.
      // Granting is deliberately not this service's job: setSalesRole is
      // guarded by requireRole, not requireSales, precisely so a Sales Admin
      // cannot widen their own team.
      if (!owner.user?.salesRole) {
        throw new AppError(
          400,
          `${owner.fullName} does not have Techno Sales Hub access yet. Grant it from their employee record before making them the owner.`
        )
      }
      if (!employmentAllowsSales(owner.employmentStatus, owner.lastWorkingDay)) {
        throw new AppError(
          400,
          `${owner.fullName} has left the company and cannot own an account. Choose someone who is still employed.`
        )
      }
      if (!owner.user.isActive) {
        throw new AppError(
          400,
          `${owner.fullName}'s login has been deactivated, so they cannot open the hub. Reactivate their account before making them the owner.`
        )
      }
      if (!canBeAccountOwner(standingOf(owner))) {
        throw new AppError(
          400,
          `${owner.fullName} is a Sales Admin. Sales Admins manage the hub rather than owning accounts in it — choose a Sales User as the owner.`
        )
      }

      // The owner is already on the account. Storing them again as an
      // assignment is the same fact twice, and the two copies drift.
      //
      // Deduped as well: a repeated id violates
      // @@unique([salesAccountId, employeeId]), which the error middleware
      // renders as a 500 for what is really a harmless double-click.
      const extras = [...new Set(body.assigneeIds ?? [])].filter((id) => id !== owner.id)

      // Populated below when there are extras, and reused for the return
      // value so the caller sees names, not just a count, without a second
      // query for the same rows this validation already fetched.
      let assignees: { id: string; fullName: string }[] = []

      if (extras.length > 0) {
        // The relation is required, so the database would refuse an unknown id
        // anyway — but as a P2003 the error middleware renders it as a 500.
        // Checking first turns that into the same 400 the owner field already
        // gives, instead of two different answers to one mistake. One query,
        // not one per id.
        const found = await tx.employee.findMany({
          where: { id: { in: extras } },
          select: {
            id: true,
            fullName: true,
            employmentStatus: true,
            lastWorkingDay: true,
            user: { select: { salesRole: true, isActive: true } },
          },
        })
        const byId = new Map(found.map((employee) => [employee.id, employee]))
        for (const id of extras) {
          const employee = byId.get(id)
          if (!employee) {
            throw new AppError(400, `${id} is not an employee`)
          }
          // Same rules as the owner: a collaborator works the account, so
          // they must be able to open it and must still be here to do it.
          if (!employee.user?.salesRole) {
            throw new AppError(
              400,
              `${employee.fullName} does not have Techno Sales Hub access yet. Grant it from their employee record first.`
            )
          }
          if (!employmentAllowsSales(employee.employmentStatus, employee.lastWorkingDay)) {
            throw new AppError(
              400,
              `${employee.fullName} has left the company and cannot be added as a collaborator.`
            )
          }
          if (!employee.user.isActive) {
            throw new AppError(
              400,
              `${employee.fullName}'s login has been deactivated, so they cannot open the hub.`
            )
          }
          if (!canBeAccountOwner(standingOf(employee))) {
            throw new AppError(
              400,
              `${employee.fullName} is a Sales Admin, and already has access to every account — they do not need to be added as a collaborator.`
            )
          }
        }
        assignees = extras.map((id) => ({ id, fullName: byId.get(id)!.fullName }))
      }

      const account = await tx.salesAccount.create({
        data: {
          name: body.name,
          industry: body.industry ?? null,
          website: body.website ?? null,
          address: body.address ?? null,
          ownerEmployeeId: owner.id,
          createdBy: actor.sub,
        },
      })

      if (extras.length > 0) {
        await tx.salesAccountAssignment.createMany({
          data: extras.map((employeeId) => ({
            salesAccountId: account.id,
            employeeId,
            assignedBy: actor.sub,
          })),
        })
      }

      await writeAudit(tx, {
        entity: "SALES_ACCOUNT",
        entityId: account.id,
        action: "CREATE",
        changedBy: actor.sub,
        after: { name: account.name, ownerEmployeeId: owner.id, status: account.status },
      })

      await emitEvent(tx, {
        type: "sales.account.created",
        entity: "SALES_ACCOUNT",
        entityId: account.id,
        actorUserId: actor.sub,
        subjectEmployeeId: owner.id,
        // Explicit null suppresses the reporting-line lookup. A sales account
        // is not a fact about somebody's manager.
        managerEmployeeId: null,
        // Event rows written before the rename keep their old wording: they
        // record what was announced at the time, and are not a template.
        title: `${account.name} added to the Techno Sales Hub`,
        meta: `Owner: ${owner.fullName}`,
        href: `/accounts/${account.id}`,
      })

      return {
        id: account.id,
        name: account.name,
        industry: account.industry,
        website: account.website,
        address: account.address,
        status: account.status,
        ownerEmployeeId: owner.id,
        ownerName: owner.fullName,
        assigneeCount: extras.length,
        assignees,
        // Just validated as eligible a few lines above, so this is true by
        // construction rather than by a second check.
        ownerActive: true,
        // Creating an account is a Sales Admin act, and canManageAccount
        // already returns true for one — spelled out here rather than
        // computed, since the actor that just created this is always able
        // to manage it.
        canManage: true,
        // Not `true` to match: a Super Admin can create an account and still
        // be unable to log a call against it, having no Employee row to be
        // the author.
        canLogActivity: actorEmployeeId !== null,
        createdAt: account.createdAt.toISOString(),
      }
    })
  } catch (err) {
    // Two admins submitting the same name in the same instant both pass the
    // check above and both insert; the loser lands here. Caught around the
    // transaction and not inside it, matching `createCategory` — the failed
    // statement has already aborted the transaction, so the re-read has to
    // happen on a fresh connection.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      const clash = await findClash(prisma, body.name)
      throw clash
        ? new AppError(409, duplicateNameMessage(clash.name, clash.owner.fullName))
        : new AppError(409, `"${body.name}" already exists`)
    }
    throw err
  }
}

export interface SalesEligibleEmployee {
  id: string
  fullName: string
  designation: string
}

/**
 * Who the "New Sales Account" owner/collaborator pickers may offer.
 *
 * Sales Users who are still employed, and only those. Both rules are
 * enforced again in `createSalesAccount` — filtering here is what makes the
 * picker honest, but the client is never the boundary:
 *
 * - **Sales Users, not Sales Admins.** An admin administers the hub rather
 *   than carrying accounts inside it (`canBeAccountOwner`).
 * - **Still employed.** An account owned by someone who has left is
 *   answerable to nobody, and their tokens no longer carry a sales role, so
 *   they could not open it in any case.
 */
export async function listSalesEligibleEmployees(): Promise<SalesEligibleEmployee[]> {
  const candidates = await prisma.employee.findMany({
    // `isActive` is a separate fact from `employmentStatus` throughout this
    // codebase — a current employee can have a disabled login — and a
    // deactivated login cannot authenticate at all, so offering them here
    // hands an account to somebody who can never open it.
    where: { user: { salesRole: SalesRole.SALES_USER, isActive: true } },
    select: {
      id: true,
      fullName: true,
      designation: true,
      employmentStatus: true,
      lastWorkingDay: true,
    },
    orderBy: { fullName: "asc" },
  })

  // Filtered in memory rather than in the `where`: a leaver serving notice is
  // still eligible until their last working day, which is a comparison
  // against "today" that Prisma cannot express without a raw query. The
  // candidate set is the sales team, so this is a handful of rows.
  return candidates
    .filter((employee) => employmentAllowsSales(employee.employmentStatus, employee.lastWorkingDay))
    .map(({ id, fullName, designation }) => ({ id, fullName, designation }))
}

/** Shared so the list and the detail page cannot describe an account differently. */
const SUMMARY_INCLUDE = {
  owner: {
    select: {
      fullName: true,
      employmentStatus: true,
      lastWorkingDay: true,
      user: { select: { salesRole: true, isActive: true } },
    },
  },
  assignments: { select: { employee: { select: { id: true, fullName: true } } } },
} as const

type AccountRow = {
  id: string
  name: string
  industry: string | null
  website: string | null
  address: string | null
  status: SalesAccountSummary["status"]
  ownerEmployeeId: string
  createdAt: Date
  owner: {
    fullName: string
    employmentStatus: EmploymentStatus
    lastWorkingDay: Date | null
    user: { salesRole: SalesRole | null; isActive: boolean } | null
  }
  assignments: { employee: { id: string; fullName: string } }[]
}

/**
 * `employeeId` and `canManage` are per-*viewer*, not per-account, so they are
 * arguments rather than something `toSummary` could derive from the row
 * alone — the same account is "mine" for its owner and "not mine, just
 * visible" for everyone else in "All Accounts".
 */
function toSummary(
  account: AccountRow,
  actor: AccessTokenPayload,
  viewerEmployeeId: string | null
): SalesAccountSummary {
  const assignees = account.assignments.map((a) => a.employee)
  const canManage = canManageAccount(
    actor,
    viewerEmployeeId,
    account.ownerEmployeeId,
    assignees.map((a) => a.id)
  )
  return {
    id: account.id,
    name: account.name,
    industry: account.industry,
    website: account.website,
    address: account.address,
    status: account.status,
    ownerEmployeeId: account.ownerEmployeeId,
    ownerName: account.owner.fullName,
    assigneeCount: assignees.length,
    assignees,
    // Eligibility is checked when an account is created, but ownership
    // outlives that moment: revoking someone's hub access or recording their
    // exit leaves the account still naming them. Nothing blocks either
    // operation — HR's workflow is not the Sales Hub's to gate — so the state
    // is surfaced instead of prevented, and a Sales Admin can see which
    // accounts need a new owner.
    ownerActive: canWorkAccounts(standingOf(account.owner)),
    canManage,
    // Permission is necessary but not sufficient: authorship is a required
    // column, so a caller with no Employee row cannot log one however senior.
    canLogActivity: canManage && viewerEmployeeId !== null,
    createdAt: account.createdAt.toISOString(),
  }
}

/**
 * "My Accounts" — owned or assigned, literally, for everyone including an
 * admin. `ownedScopeFor`, not `accountScopeFor`: an admin's *permission* to
 * reach every account is not a claim that every account is theirs, and using
 * the permission scope here made this page an exact copy of "All Accounts"
 * for every admin who opened it.
 */
export async function listSalesAccounts(
  actor: AccessTokenPayload
): Promise<SalesAccountSummary[]> {
  const employeeId = await employeeIdFor(actor)
  const accounts = await prisma.salesAccount.findMany({
    where: ownedScopeFor(employeeId),
    orderBy: { name: "asc" },
    include: SUMMARY_INCLUDE,
  })
  return accounts.map((a) => toSummary(a, actor, employeeId))
}

/**
 * "All Accounts" — the shared directory. Every account, to every Sales Hub
 * member, with `canManage` telling the client which ones they can actually
 * work rather than merely see. Deliberately unscoped: this is the read side
 * of the split `requireAccountVisible` documents in sales.access.ts.
 */
export async function listAllSalesAccounts(
  actor: AccessTokenPayload
): Promise<SalesAccountSummary[]> {
  // Independent: this list is deliberately unscoped, so the caller's employee
  // id is not part of the query — it is only needed afterwards, to decide
  // `canManage` per row. Issued together rather than one after the other.
  const [employeeId, accounts] = await Promise.all([
    employeeIdFor(actor),
    prisma.salesAccount.findMany({ orderBy: { name: "asc" }, include: SUMMARY_INCLUDE }),
  ])
  return accounts.map((a) => toSummary(a, actor, employeeId))
}

export async function getSalesAccount(
  id: string,
  actor: AccessTokenPayload
): Promise<SalesAccountSummary> {
  // The visibility check and the caller's employee id do not depend on each
  // other, so they go together. The account read waits for the check — it
  // must not run for an account the caller may not see.
  const [, employeeId] = await Promise.all([
    requireAccountVisible(id, actor),
    employeeIdFor(actor),
  ])
  // requireAccountVisible already confirmed the row exists; a second,
  // unscoped read here (rather than passing its result through) keeps this
  // function the one place SUMMARY_INCLUDE and toSummary are wired together.
  const account = await prisma.salesAccount.findUniqueOrThrow({
    where: { id },
    include: SUMMARY_INCLUDE,
  })
  return toSummary(account, actor, employeeId)
}

/**
 * The field-by-field record for an account: its own audit rows, plus its
 * contacts'. Not the contacts' communications — logging one is not audited
 * in its own right (`communication.service.ts`: "a communication is already
 * a Timeline row"), so there is nothing here to merge in for it.
 *
 * Merged in the service for the same reason the Timeline is: `AuditLog` is
 * polymorphic by `(entity, entityId)`, so a contact's rows live under its
 * own id, not the account's — one query with an `OR`, not the account read
 * followed by one query per contact.
 */
export async function getAccountHistory(
  accountId: string,
  actor: AccessTokenPayload
): Promise<AccountHistory> {
  await requireAccountVisible(accountId, actor)

  const contacts = await prisma.salesContact.findMany({
    where: { salesAccountId: accountId },
    select: { id: true },
  })
  const contactIds = contacts.map((c) => c.id)

  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [
        { entity: "SALES_ACCOUNT", entityId: accountId },
        ...(contactIds.length > 0
          ? [{ entity: "SALES_CONTACT" as const, entityId: { in: contactIds } }]
          : []),
      ],
    },
    orderBy: { changedAt: "desc" },
    // Capped like the Timeline, and for the same reason: this grows forever,
    // every row is rendered, and an account worked for a year would send
    // thousands. An account with more history than this needs paging, which
    // is a Phase 2 conversation — `truncated` says so rather than quietly
    // dropping the rest.
    take: HISTORY_LIMIT + 1,
  })

  // Asking for one more than the cap is how we learn there *is* more without
  // a second COUNT query; the extra row is dropped before rendering.
  const truncated = rows.length > HISTORY_LIMIT
  const page = truncated ? rows.slice(0, HISTORY_LIMIT) : rows

  // One pass over every row to collect the ids, then two queries — rather
  // than a lookup per row, which on a busy account is twenty round trips to
  // name the same three people.
  const names = await resolveNames(page)

  const items = page.map((row) => ({
    id: row.id,
    entity: row.entity as AccountHistoryEntry["entity"],
    entityId: row.entityId,
    action: row.action,
    changedAt: row.changedAt.toISOString(),
    // Null, not the "Someone no longer on file" wording `presentChanges`
    // uses for an unresolved id inside a change. Deliberately different:
    // this is a byline, and "Updated · Someone no longer on file" is noise
    // where simply omitting the name is not. Inside a change, the id *is*
    // the value being reported, so it has to say something.
    changedByName: row.changedBy ? (names.get(row.changedBy) ?? null) : null,
    changes: presentChanges(row.before, row.after, names),
    note: row.note,
  }))

  return { items, truncated, limit: HISTORY_LIMIT }
}
