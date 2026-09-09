import prisma from "../../config/prisma"
import type { HistoryChange } from "./sales.types"

/**
 * Turning an audit row's raw `before`/`after` JSON into something a person
 * can read.
 *
 * The panel used to print the JSON almost verbatim — `ownerEmployeeId:
 * "88604c6a-bec5-42fc-9586-6c7394bf16db"` run together with the name and
 * status by commas, on one line. Three separate problems: the keys were
 * database column names, the values included raw uuids nobody can resolve by
 * eye, and it was one string where it should be a list of changes.
 *
 * Presented here rather than in the client because only the server can turn
 * an id into a name, and splitting the work would leave the client
 * re-deriving half the labels anyway.
 */

/** Column name to something you would say out loud. */
const FIELD_LABEL: Record<string, string> = {
  name: "Name",
  status: "Status",
  ownerEmployeeId: "Owner",
  industry: "Industry",
  website: "Website",
  address: "Address",
  isPrimary: "Primary contact",
  verifiedAt: "Verified",
  verifiedBy: "Verified by",
  designation: "Designation",
  phone: "Phone",
  email: "Email",
  note: "Note",
  salesRole: "Techno Sales Hub access",
}

/**
 * Fields worth no row of their own.
 *
 * `salesAccountId` on a contact's audit row restates the account you are
 * already looking at, and `id` is the row's own primary key. Both were pure
 * noise in a panel whose whole job is "what changed".
 */
const HIDDEN_FIELDS = new Set(["salesAccountId", "id", "createdBy", "createdAt", "updatedAt"])

/**
 * Which fields hold an *employee* id, and which hold a *user* id.
 *
 * Keyed by field name rather than by the value looking like a uuid. The shape
 * of an id is not its meaning: a seeded or test id such as `emp-7` is just as
 * much an employee reference, and matching on the uuid pattern silently left
 * those unresolved while appearing to work everywhere else.
 */
const EMPLOYEE_ID_FIELDS = new Set(["ownerEmployeeId", "employeeId", "assigneeId"])
const USER_ID_FIELDS = new Set(["verifiedBy", "changedBy", "decidedBy"])

const isIdField = (field: string) => EMPLOYEE_ID_FIELDS.has(field) || USER_ID_FIELDS.has(field)

/**
 * Fields whose values are enums, and so are stored SHOUTING.
 *
 * Listed explicitly rather than detected by pattern. Matching on
 * `/^[A-Z_]+$/` treated *any* all-caps string as an enum, which quietly
 * corrupted real data: a company called IBM rendered as "Ibm", an industry of
 * NGO as "Ngo". Whether a value is an enum is a fact about the column, never
 * about how the text happens to be capitalised.
 */
const ENUM_FIELDS = new Set(["status", "salesRole", "employmentStatus", "exitReason", "channel"])

/** ACTIVE → Active, DO_NOT_CONTACT → Do not contact. */
function humaniseEnum(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ")
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * Every uuid these rows mention, resolved to a name in two queries rather
 * than one per row — the panel routinely shows twenty entries, and most of
 * them name the same handful of people.
 */
export async function resolveNames(
  rows: { before: unknown; after: unknown; changedBy: string | null }[]
): Promise<Map<string, string>> {
  const employeeIds = new Set<string>()
  const userIds = new Set<string>()

  for (const row of rows) {
    if (row.changedBy) userIds.add(row.changedBy)
    for (const source of [asRecord(row.before), asRecord(row.after)]) {
      for (const [key, value] of Object.entries(source)) {
        if (typeof value !== "string" || value === "") continue
        if (EMPLOYEE_ID_FIELDS.has(key)) employeeIds.add(value)
        else if (USER_ID_FIELDS.has(key)) userIds.add(value)
      }
    }
  }

  const names = new Map<string, string>()
  if (employeeIds.size === 0 && userIds.size === 0) return names

  const [employees, users] = await Promise.all([
    employeeIds.size
      ? prisma.employee.findMany({
          where: { id: { in: [...employeeIds] } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
    userIds.size
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          // Three fallbacks, best first: staff get their name from HR, an
          // administrative login gets whatever name it set for itself, and
          // the email is the last resort — an address is at least something
          // a person can act on, unlike a uuid.
          select: {
            id: true,
            email: true,
            displayName: true,
            employee: { select: { fullName: true } },
          },
        })
      : Promise.resolve([]),
  ])

  for (const employee of employees) names.set(employee.id, employee.fullName)
  for (const user of users) {
    names.set(user.id, user.employee?.fullName ?? user.displayName ?? user.email)
  }
  return names
}

/**
 * One value, rendered: ids become names where a name is known, a null becomes
 * a word rather than the literal "null", a boolean becomes Yes or No.
 */
function present(field: string, value: unknown, names: Map<string, string>): string {
  if (value === null || value === undefined) {
    // "Verified: —" reads as missing data; "Verified: No" is the actual fact.
    if (field === "verifiedAt" || field === "isPrimary") return "No"
    if (field === "salesRole") return "No access"
    return "—"
  }
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (isIdField(field) && typeof value === "string") {
    return names.get(value) ?? "Someone no longer on file"
  }
  if (typeof value === "string") {
    // Verbatim unless the *column* is an enum — a customer's name is theirs
    // to capitalise, however they choose to.
    return ENUM_FIELDS.has(field) ? humaniseEnum(value) : value
  }
  return String(value)
}

/**
 * The changed fields of one audit row, as a list the panel can lay out.
 *
 * `before`/`after` are only ever the fields that changed — `writeAudit`'s own
 * contract — so an absent `before` means the field was set for the first
 * time, not that it held nothing.
 */
export function presentChanges(
  before: unknown,
  after: unknown,
  names: Map<string, string>
): HistoryChange[] {
  const beforeRecord = asRecord(before)
  const afterRecord = asRecord(after)

  const fields = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].filter(
    (field) => !HIDDEN_FIELDS.has(field)
  )

  return fields.map((field) => ({
    field,
    label: FIELD_LABEL[field] ?? field,
    // Null rather than a rendered "—": the client shows one value for "this
    // was set" and an arrow only for a genuine before-and-after change.
    before: field in beforeRecord ? present(field, beforeRecord[field], names) : null,
    after: present(field, afterRecord[field], names),
  }))
}
