const MS_DAY = 86_400_000
/** A task due within three days is not late yet, but it is not comfortable either. */
const AT_RISK_DAYS = 3

/**
 * How far along a Project is (spec §2.3). Cancelled tasks are not counted at
 * all: work somebody took off the list was never part of the job. Null, not
 * zero, when there is nothing to count, so the page can say "No tasks yet"
 * instead of showing 0%.
 */
export function progressOf(tasks: Array<{ status: string }>): { done: number; total: number; percent: number } | null {
  const counted = tasks.filter((t) => t.status !== "CANCELLED")
  if (counted.length === 0) return null
  const done = counted.filter((t) => t.status === "DONE").length
  return { done, total: counted.length, percent: Math.round((done / counted.length) * 100) }
}

/**
 * Open and late work per person. Everybody on the Project is listed, including
 * somebody with nothing to do today, because "0 open" is a real answer and an
 * empty row would read as missing data.
 */
export function peopleNumbers(
  tasks: Array<{ status: string; dueOn: Date; assignedToEmployeeId: string }>,
  people: Array<{ employeeId: string; fullName: string }>,
  today: Date,
): Array<{ employeeId: string; fullName: string; open: number; late: number }> {
  return people.map((p) => {
    const mine = tasks.filter((t) => t.assignedToEmployeeId === p.employeeId && t.status === "PENDING")
    return {
      employeeId: p.employeeId, fullName: p.fullName, open: mine.length,
      late: mine.filter((t) => t.dueOn.getTime() < today.getTime()).length,
    }
  })
}

/**
 * On track / At risk / Late (spec §2.3). Null when there is nothing honest to
 * say: a finished or cancelled Project has no health, and a Project that has
 * not started and has no work out is not behind anybody's schedule.
 */
export function healthOf(
  project: { status: string; dueOn: Date | null },
  tasks: Array<{ status: string; dueOn: Date }>,
  today: Date,
): "ON_TRACK" | "AT_RISK" | "LATE" | null {
  if (project.status === "COMPLETED" || project.status === "CANCELLED") return null
  const pending = tasks.filter((t) => t.status === "PENDING")
  if (project.status === "NOT_STARTED" && pending.length === 0) return null
  const t0 = today.getTime()
  // Late beats At risk: a Project can be both, and saying "at risk" when the
  // finish date has already gone would understate it.
  if (pending.some((t) => t.dueOn.getTime() < t0)) return "LATE"
  if (project.dueOn && project.dueOn.getTime() < t0) return "LATE"
  if (pending.some((t) => t.dueOn.getTime() <= t0 + AT_RISK_DAYS * MS_DAY)) return "AT_RISK"
  return "ON_TRACK"
}
