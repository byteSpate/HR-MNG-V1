/**
 * "Next person" on the Saturday page (owner, 2026-11-02): the admin walks the
 * team one person at a time, in the order of the team list. This gives the id
 * of the person after the current one, or null at the end of the list (or when
 * the current person is not on it).
 */
export function nextPerson(rows: { employeeId: string }[], currentId: string): string | null {
  const index = rows.findIndex((row) => row.employeeId === currentId)
  if (index === -1) return null
  return rows[index + 1]?.employeeId ?? null
}
