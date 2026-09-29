/**
 * The body of one Daily Log save. A Weekly Report day carries a full timestamp
 * ("2026-09-26T00:00:00.000Z") and the server accepts only the day, so the day
 * is cut here, in one place, and cannot be forgotten by a caller. "No work" and
 * a line are alternatives: with the tick there is no text to send.
 */
export function projectLogBody(
  date: string,
  projectId: string,
  entry: { text: string; noWork: boolean },
) {
  return {
    date: date.slice(0, 10),
    projectId,
    noWork: entry.noWork,
    text: entry.noWork ? null : entry.text.trim(),
  }
}
