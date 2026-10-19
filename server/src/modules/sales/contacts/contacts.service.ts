import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { accountScopeFor, employeeIdFor } from "../sales.access"
import type { ContactDirectoryPage, ContactDirectoryRow } from "../sales.types"
import type { ListContactsQuery } from "./contacts.validators"

/**
 * The Contacts page (owner, 2026-10-18): every contact of every account the
 * viewer may see, with one search box. Who sees what is the same rule as the
 * account list (`accountScopeFor`), so the two can never disagree.
 */

export const CONTACTS_PAGE_SIZE = 50

export const CONTACT_SELECT = {
  id: true, name: true, designation: true, phone: true, email: true, status: true, isPrimary: true,
  salesAccount: { select: { id: true, name: true } },
} as const

/**
 * The visible contacts that match the search. `contains` with
 * `mode: "insensitive"` matches the typed text as it is, so % and _ are
 * letters, not wildcards.
 */
export async function contactsWhere(q: string | undefined, actor: AccessTokenPayload): Promise<Prisma.SalesContactWhereInput> {
  const scope = accountScopeFor(actor, await employeeIdFor(actor))
  const text = { contains: q ?? "", mode: "insensitive" as const }
  const search: Prisma.SalesContactWhereInput = q
    ? { OR: [{ name: text }, { designation: text }, { phone: text }, { email: text }, { salesAccount: { name: text } }] }
    : {}
  return { AND: [{ salesAccount: scope }, search] }
}

export function contactsOrderBy(sort: ListContactsQuery["sort"], dir: ListContactsQuery["dir"]): Prisma.SalesContactOrderByWithRelationInput[] {
  const first: Prisma.SalesContactOrderByWithRelationInput =
    sort === "account" ? { salesAccount: { name: dir } } : sort === "designation" ? { designation: dir } : sort === "status" ? { status: dir } : { name: dir }
  return [first, { id: "asc" }]
}

type ContactRow = Prisma.SalesContactGetPayload<{ select: typeof CONTACT_SELECT }>

export function presentContact(r: ContactRow): ContactDirectoryRow {
  return {
    id: r.id, name: r.name, designation: r.designation, phone: r.phone, email: r.email,
    status: r.status, isPrimary: r.isPrimary, accountId: r.salesAccount.id, accountName: r.salesAccount.name,
  }
}

export async function listAllContacts(query: ListContactsQuery, actor: AccessTokenPayload): Promise<ContactDirectoryPage> {
  const where = await contactsWhere(query.q, actor)
  const [rows, total] = await Promise.all([
    prisma.salesContact.findMany({
      where,
      orderBy: contactsOrderBy(query.sort, query.dir),
      skip: (query.page - 1) * CONTACTS_PAGE_SIZE,
      take: CONTACTS_PAGE_SIZE,
      select: CONTACT_SELECT,
    }),
    prisma.salesContact.count({ where }),
  ])
  return { rows: rows.map(presentContact), total, page: query.page, pageSize: CONTACTS_PAGE_SIZE }
}
