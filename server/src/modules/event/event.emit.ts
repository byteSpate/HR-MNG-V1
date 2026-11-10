/**
 * Writing to the event log.
 *
 * `emitEvent` takes a transaction client and never the global `prisma`,
 * matching `writeAudit` and `auditAttendance` — it is called inside the
 * same transaction as the change it records, so an announcement can never
 * outlive a rolled-back write.
 *
 * There is no Prisma middleware and no automatic emission anywhere: every
 * event is an explicit call in a service, because only the calling code
 * knows whether one user action touched one record or a hundred.
 */

import type { Event } from "../../generated/prisma/client"
import { fanOutEvent } from "../inbox/inbox.fanout"
import type { EventInput, EventTx } from "./event.types"

export async function emitEvent(tx: EventTx, input: EventInput): Promise<Event> {
  const subjectEmployeeId = input.subjectEmployeeId ?? null

  // Frozen at emit rather than joined at read: the read becomes an indexed
  // equality instead of a subquery, and the person notified stays whoever
  // was their manager when it happened — not whoever inherited the team
  // afterwards.
  //
  // An explicit `null` means "this event has no manager audience" and
  // suppresses the lookup — `undefined` means "work it out". The distinction
  // is load-bearing: payroll's own rule is that a manager may not see their
  // reports' payslips, so a payslip event that silently resolved a reporting
  // line would route pay information to someone the payslip endpoint refuses.
  let managerEmployeeId = input.managerEmployeeId ?? null
  if (input.managerEmployeeId === undefined && subjectEmployeeId !== null) {
    const subject = await tx.employee.findUnique({
      where: { id: subjectEmployeeId },
      select: { reportingManagerId: true },
    })
    // A subject with no manager writes null rather than throwing. The CEO
    // filing leave is not an error, and refusing to record it would be.
    managerEmployeeId = subject?.reportingManagerId ?? null
  }

  const row = await tx.event.create({
    data: {
      type: input.type,
      severity: input.severity ?? "INFO",
      actorUserId: input.actorUserId ?? null,
      entity: input.entity,
      entityId: input.entityId,
      subjectEmployeeId,
      managerEmployeeId,
      targetRoles: input.targetRoles ?? [],
      companyWide: input.companyWide ?? false,
      audienceDepartmentId: input.audienceDepartmentId ?? null,
      title: input.title,
      meta: input.meta ?? null,
      href: input.href ?? null,
      payload: input.payload,
    },
  })

  // Same transaction: a notification never outlives a rolled-back change.
  await fanOutEvent(tx, row)
  return row
}
