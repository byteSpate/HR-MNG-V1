import prisma from "../../../config/prisma"
import type { Prisma } from "../../../generated/prisma/client"
import { AppError } from "../../../middleware/errorHandler"
import { writeAudit } from "../../../utils/audit"
import { formatDateOnly, parseDateOnly } from "../../../utils/dates"
import type { AccessTokenPayload } from "../../auth/auth.types"
import { officeDateOf } from "../../attendance/attendance.time"
import { emitEvent } from "../../event/event.emit"
import type { SalesTaskSummary } from "../sales.types"
import { presentTask } from "../tasks/task.present"
import { canManageProject, loadProjectRow } from "./project.access"
import { asClient } from "./project.service"
import type { AddProjectTaskBody, CancelProjectTaskBody } from "./project.validators"

/**
 * A Project Task is a `SalesTask` with `origin: PROJECT` (spec §2.1), so it
 * shows on the same Tasks page, carries the same reminders and closes on the
 * same rule as every other piece of work. One task system, not two.
 */
const TASK_INCLUDE = {
  salesAccount: { select: { name: true } },
  opportunity: { select: { serial: true, name: true } },
  meeting: { select: { title: true } },
  assignedTo: { select: { fullName: true } },
} satisfies Prisma.SalesTaskInclude

const TASK_NOT_FOUND = "That task does not exist, or is not yours"

export async function listProjectTasks(projectId: string, actor: AccessTokenPayload): Promise<SalesTaskSummary[]> {
  const { employeeId } = await loadProjectRow(prisma, projectId, actor)
  const tasks = await prisma.salesTask.findMany({
    where: { projectId },
    include: TASK_INCLUDE,
    orderBy: [{ status: "asc" }, { dueOn: "asc" }],
  })
  const today = officeDateOf(new Date())
  // `canManage` on a task is "may close it", which is the assignee's alone: the
  // status endpoint refuses anybody else. The Project Manager's power over a
  // task is to cancel it, and the page reads that from the Project.
  return tasks.map((t) => presentTask(t, t.assignedToEmployeeId === employeeId, today))
}

export async function addProjectTask(
  projectId: string, body: AddProjectTaskBody, actor: AccessTokenPayload,
): Promise<SalesTaskSummary> {
  return prisma.$transaction(async (tx) => {
    const { row, employeeId } = await loadProjectRow(asClient(tx), projectId, actor)
    const manages = canManageProject(actor, employeeId, row.managerEmployeeId)
    // Nobody named means the caller takes it, which is what a team member does.
    const assigneeId = body.assigneeEmployeeId ?? employeeId
    if (!assigneeId) throw new AppError(403, "Only somebody with an employee record can be given a task.")
    const onTeam = employeeId !== null && row.team.some((m) => m.employeeId === employeeId)
    if (!manages && !onTeam) throw new AppError(403, "Only the Project Team, the Project Manager or a Sales Admin can add a task.")
    // A team member can take work on themselves, but handing work to somebody
    // else is the Project Manager's call.
    if (!manages && assigneeId !== employeeId) {
      throw new AppError(403, "You can add a task only for yourself. The Project Manager gives tasks to others.")
    }
    // The assignee must be somebody this Project can actually use. Checked
    // after the permission checks, so the refusal is about the person, not
    // about who is asking.
    const allowed = new Set([row.managerEmployeeId, ...row.team.map((m) => m.employeeId)])
    if (!allowed.has(assigneeId)) {
      const who = await tx.employee.findUnique({
        where: { id: assigneeId }, select: { fullName: true },
      })
      throw new AppError(400, `${who?.fullName ?? "That person"} is not on this Project's team. Add them to the team first.`)
    }
    let dueOn: Date
    try {
      dueOn = parseDateOnly(body.dueOn)
    } catch {
      throw new AppError(400, `${body.dueOn} is not a date on the calendar`)
    }
    const created = await tx.salesTask.create({
      data: {
        origin: "PROJECT", projectId, salesAccountId: row.salesAccountId, opportunityId: row.opportunityId,
        title: body.title, dueOn, priority: "NORMAL",
        assignedToEmployeeId: assigneeId,
        // A task somebody took for themselves was given by nobody.
        assignedByEmployeeId: assigneeId === employeeId ? null : employeeId,
      },
      include: TASK_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "SALES_TASK", entityId: created.id, action: "CREATE", changedBy: actor.sub,
      after: { projectId, title: body.title, dueOn: formatDateOnly(dueOn), assignedToEmployeeId: assigneeId },
    })
    await emitEvent(tx, {
      type: "sales.task.created", entity: "SALES_TASK", entityId: created.id, actorUserId: actor.sub,
      subjectEmployeeId: assigneeId, managerEmployeeId: null,
      title: `Project task: ${body.title}`, meta: row.serial, href: "/tasks",
    })
    return presentTask(created, assigneeId === employeeId, officeDateOf(new Date()))
  })
}

export async function cancelProjectTask(
  taskId: string, body: CancelProjectTaskBody, actor: AccessTokenPayload,
): Promise<SalesTaskSummary> {
  return prisma.$transaction(async (tx) => {
    const task = await tx.salesTask.findUnique({ where: { id: taskId }, include: TASK_INCLUDE })
    if (!task || !task.projectId) throw new AppError(404, TASK_NOT_FOUND)
    const { row, employeeId } = await loadProjectRow(asClient(tx), task.projectId, actor)
    if (!canManageProject(actor, employeeId, row.managerEmployeeId)) {
      throw new AppError(403, "Only the Project Manager or a Sales Admin can cancel a Project Task.")
    }
    if (task.status !== "PENDING") throw new AppError(409, "Only a pending task can be cancelled.")
    const updated = await tx.salesTask.update({
      where: { id: taskId },
      data: { status: "CANCELLED", cancelReason: body.reason },
      include: TASK_INCLUDE,
    })
    await writeAudit(tx, {
      entity: "SALES_TASK", entityId: taskId, action: "UPDATE", changedBy: actor.sub,
      before: { status: "PENDING" }, after: { status: "CANCELLED" }, note: body.reason,
    })
    return presentTask(updated, true, officeDateOf(new Date()))
  })
}
