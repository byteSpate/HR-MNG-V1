/**
 * The minutes template on Sales Settings (revision §25.20, §25.21, §25.30).
 *
 * One template for everyone, changed by anyone in the hub (the owner opened it
 * to Sales Users on 2026-09-15; the audit row says who changed what). It is
 * read when a document is started and never again, so a change reaches new
 * minutes only: minutes already written keep the sections they started with.
 *
 * One row, id 1. No row means nobody has changed the template, and the
 * default from the four real documents applies.
 */

import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { writeAudit } from "../../../utils/audit"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { DEFAULT_TEMPLATE, templateSchema, type TemplateBody, type TemplateSection } from "./minutes.content"

const TEMPLATE_ID = 1

export interface MinutesTemplateView {
  sections: TemplateSection[]
  /** True until a Sales Admin saves one, or when the saved one no longer reads. */
  isDefault: boolean
  updatedAt: string | null
}

type TemplateRow = { sections: unknown; updatedAt: Date } | null

function present(row: TemplateRow): MinutesTemplateView {
  const parsed = row ? templateSchema.safeParse({ sections: row.sections }) : null
  if (!row || !parsed?.success) return { sections: DEFAULT_TEMPLATE, isDefault: true, updatedAt: null }
  return { sections: parsed.data.sections, isDefault: false, updatedAt: row.updatedAt.toISOString() }
}

/** What new minutes start from. Takes the caller's transaction when it has one. */
export async function templateForNewMinutes(client: typeof prisma = prisma): Promise<TemplateSection[]> {
  const row = await client.salesMinutesTemplate.findUnique({ where: { id: TEMPLATE_ID } })
  return present(row).sections
}

export async function getMinutesTemplate(): Promise<MinutesTemplateView> {
  return present(await prisma.salesMinutesTemplate.findUnique({ where: { id: TEMPLATE_ID } }))
}

const headings = (sections: TemplateSection[]) => sections.map((section) => section.heading).join(", ")

export async function saveMinutesTemplate(body: TemplateBody, actor: AccessTokenPayload): Promise<MinutesTemplateView> {
  // Only what the template holds: a stray key never reaches the stored JSON.
  const sections: TemplateSection[] = body.sections.map(({ heading, kind, startsWithOutcome }) =>
    startsWithOutcome ? { heading, kind, startsWithOutcome: true } : { heading, kind }
  )
  const stored = sections as unknown as Prisma.InputJsonArray
  return prisma.$transaction(async (tx) => {
    const before = present(await tx.salesMinutesTemplate.findUnique({ where: { id: TEMPLATE_ID } }))
    const saved = await tx.salesMinutesTemplate.upsert({
      where: { id: TEMPLATE_ID },
      create: { id: TEMPLATE_ID, sections: stored, updatedBy: actor.sub },
      update: { sections: stored, updatedBy: actor.sub },
    })
    // The headings in order are the change a reader looks for: what was
    // added, dropped, renamed or moved.
    await writeAudit(tx, {
      entity: "SALES_MINUTES_TEMPLATE",
      entityId: String(TEMPLATE_ID),
      action: "UPDATE",
      changedBy: actor.sub,
      before: { sections: headings(before.sections) },
      after: { sections: headings(sections) },
    })
    return present(saved)
  })
}
