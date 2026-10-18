import type { NextFunction, Request, Response } from "express"

import prisma from "../../../config/prisma"
import { parseExportFormat, sendExport } from "../../../utils/export/export.respond"
import type { ExportSpec } from "../../../utils/export/export.types"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { parse } from "../heatmap/heatmap.controller"
import { CONTACT_SELECT, contactsOrderBy, contactsWhere } from "./contacts.service"
import { listContactsQuerySchema, type ListContactsQuery } from "./contacts.validators"

/** The same words the Contacts page uses for a contact's status. */
const STATUS_WORD: Record<string, string> = {
  UNVERIFIED: "Unverified", VERIFIED: "Verified", UNREACHABLE: "Unreachable", INVALID: "Invalid",
}

/** The Contacts page as a file: the same search and sort, every page. */
export async function buildContactsExportSpec(query: ListContactsQuery, actor: AccessTokenPayload): Promise<ExportSpec> {
  const rows = await prisma.salesContact.findMany({
    where: await contactsWhere(query.q, actor),
    orderBy: contactsOrderBy(query.sort, query.dir),
    select: CONTACT_SELECT,
  })
  return {
    title: "Contacts",
    filterNote: query.q ? `Search: ${query.q}` : undefined,
    columns: [
      { header: "Name", type: "text", inPdf: true },
      { header: "Job title", type: "text", inPdf: true },
      { header: "Phone", type: "text", inPdf: true },
      { header: "Email", type: "text", inPdf: true },
      { header: "Account", type: "text", inPdf: true },
      { header: "Status", type: "text", inPdf: true },
    ],
    rows: rows.map((r) => [r.name, r.designation, r.phone, r.email, r.salesAccount.name, STATUS_WORD[r.status] ?? r.status]),
  }
}

export async function exportContactsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const format = parseExportFormat(req.query.format)
    const query = parse(listContactsQuerySchema, req.query)
    await sendExport({
      res, spec: await buildContactsExportSpec(query, req.user!), format, baseName: "contacts",
      actor: req.user!, list: "SALES_CONTACTS", filter: { q: query.q ?? null },
    })
  } catch (err) {
    next(err)
  }
}
