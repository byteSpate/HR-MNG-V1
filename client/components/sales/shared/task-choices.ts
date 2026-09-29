import type { SalesTaskOrigin, SalesTaskStatus } from "@/lib/api/types"

/**
 * What a person may do to a task on the Tasks page. Their own task can be
 * cancelled and brought back. A Project Task belongs to the Project Manager's
 * plan: only the manager cancels it (on the Project), and only they add it
 * again, so the server refuses both from here and the page does not offer them.
 */
export function generalTaskChoices(task: { origin: SalesTaskOrigin; status: SalesTaskStatus }) {
  const project = task.origin === "PROJECT"
  return { cancel: !project, reopen: !(project && task.status === "CANCELLED") }
}

/**
 * What the Project's Tasks tab offers on one task. `canManage` on a task means
 * "the viewer is the assignee": closing a task is theirs alone. Cancelling is
 * the Project Manager's (or a Sales Admin's), whoever the task belongs to.
 */
export function projectTaskChoices(
  task: { status: SalesTaskStatus; canManage: boolean },
  projectCanManage: boolean,
) {
  const pending = task.status === "PENDING"
  return { done: pending && task.canManage, cancel: pending && projectCanManage }
}

/**
 * Who a task can be given to: the Project Manager, then the team. The manager
 * is often on the team as well, and a person listed twice is a duplicate row
 * for the eye and a duplicate key for React, so each person appears once.
 */
export function taskPeople<T extends { employeeId: string }>(manager: T, team: T[]): T[] {
  return [manager, ...team.filter((m) => m.employeeId !== manager.employeeId)]
}
