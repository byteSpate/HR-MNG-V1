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
  salesAccount: { select: { id: true, name: true, industry: true } },
} as const

/**
 * The visible contacts that match the search. `contains` with
 * `mode: "insensitive"` matches the typed text as it is, so % and _ are
 * letters, not wildcards.
 */
export async function contactsWhere(
  query: Pick<ListContactsQuery, "q" | "industry" | "status">,
  actor: AccessTokenPayload,
): Promise<Prisma.SalesContactWhereInput> {
  const { q, industry, status } = query
  const scope = accountScopeFor(actor, await employeeIdFor(actor))
  const text = { contains: q ?? "", mode: "insensitive" as const }
  const search: Prisma.SalesContactWhereInput = q
    ? { OR: [{ name: text }, { designation: text }, { phone: text }, { email: text }, { salesAccount: { name: text } }, { salesAccount: { industry: text } }] }
    : {}
  // The industry filter matches the whole word, ignoring case, so "Banking"
  // does not also pull in "Banking software".
  const byIndustry: Prisma.SalesContactWhereInput = industry
    ? { salesAccount: { industry: { equals: industry, mode: "insensitive" } } }
    : {}
  const byStatus: Prisma.SalesContactWhereInput = status ? { status } : {}
  return { AND: [{ salesAccount: scope }, search, byIndustry, byStatus] }
}

export function contactsOrderBy(sort: ListContactsQuery["sort"], requested: ListContactsQuery["dir"]): Prisma.SalesContactOrderByWithRelationInput[] {
  // Newest first for the date added, A to Z for a column, unless asked otherwise.
  const dir = requested ?? (sort === "added" ? "desc" : "asc")
  const first: Prisma.SalesContactOrderByWithRelationInput =
    sort === "added" ? { createdAt: dir } : sort === "account" ? { salesAccount: { name: dir } } : sort === "industry" ? { salesAccount: { industry: dir } } : sort === "designation" ? { designation: dir } : sort === "status" ? { status: dir } : { name: dir }
  return [first, { id: "asc" }]
}

type ContactRow = Prisma.SalesContactGetPayload<{ select: typeof CONTACT_SELECT }>

export function presentContact(r: ContactRow): ContactDirectoryRow {
  return {
    id: r.id, name: r.name, designation: r.designation, phone: r.phone, email: r.email,
    status: r.status, isPrimary: r.isPrimary, accountId: r.salesAccount.id, accountName: r.salesAccount.name,
    accountIndustry: r.salesAccount.industry,
  }
}

/**
 * The industries the viewer can filter by: those of the accounts they may see,
 * each once, whatever the letter case. Industry is typed freely on an account,
 * so "Banking" and "banking" are one choice here.
 */
export async function visibleIndustries(actor: AccessTokenPayload): Promise<string[]> {
  const scope = accountScopeFor(actor, await employeeIdFor(actor))
  const rows = await prisma.salesAccount.findMany({
    where: { AND: [scope, { industry: { not: null } }, { contacts: { some: {} } }] },
    distinct: ["industry"],
    orderBy: { industry: "asc" },
    select: { industry: true },
  })
  const seen = new Map<string, string>()
  for (const r of rows) {
    const name = r.industry?.trim()
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  return [...seen.values()]
}

export async function listAllContacts(query: ListContactsQuery, actor: AccessTokenPayload): Promise<ContactDirectoryPage> {
  const where = await contactsWhere(query, actor)
  const [rows, total, industries] = await Promise.all([
    prisma.salesContact.findMany({
      where,
      orderBy: contactsOrderBy(query.sort, query.dir),
      skip: (query.page - 1) * CONTACTS_PAGE_SIZE,
      take: CONTACTS_PAGE_SIZE,
      select: CONTACT_SELECT,
    }),
    prisma.salesContact.count({ where }),
    visibleIndustries(actor),
  ])
  return { rows: rows.map(presentContact), total, page: query.page, pageSize: CONTACTS_PAGE_SIZE, industries }
}
