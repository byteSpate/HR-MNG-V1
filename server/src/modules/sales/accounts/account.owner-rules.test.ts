import { describe, expect, it } from "vitest"

import { assertMayChangeOwner, MAY_NOT_CHANGE_OWNER, OWNER_TO_COLLABORATOR_ONLY } from "./account.owner-rules"

const USER = { sub: "u-2", role: "EMPLOYEE", salesRole: "SALES_USER" } as any
const ADMIN = { sub: "u-1", role: "EMPLOYEE", salesRole: "SALES_ADMIN" } as any
const SUPER = { sub: "u-0", role: "SUPER_ADMIN", salesRole: null } as any

const base = { currentOwnerId: "emp-1", collaboratorIds: ["emp-3"], nextOwnerId: "emp-3" }

function refusal(fn: () => void) {
  try {
    fn()
  } catch (err) {
    return err
  }
  return null
}

describe("assertMayChangeOwner", () => {
  it("lets the Owner give the Sales Account to one of its collaborators", () => {
    expect(() => assertMayChangeOwner({ ...base, actor: USER, actorEmployeeId: "emp-1" })).not.toThrow()
  })

  it("refuses the Owner naming someone who is not a collaborator", () => {
    const err = refusal(() => assertMayChangeOwner({ ...base, actor: USER, actorEmployeeId: "emp-1", nextOwnerId: "emp-9" }))
    expect(err).toMatchObject({ statusCode: 403, message: OWNER_TO_COLLABORATOR_ONLY })
  })

  it("refuses a collaborator who is not the Owner", () => {
    const err = refusal(() => assertMayChangeOwner({ ...base, actor: USER, actorEmployeeId: "emp-3" }))
    expect(err).toMatchObject({ statusCode: 403, message: MAY_NOT_CHANGE_OWNER })
  })

  it("refuses a Sales User with no Employee record", () => {
    const err = refusal(() => assertMayChangeOwner({ ...base, actor: USER, actorEmployeeId: null }))
    expect(err).toMatchObject({ statusCode: 403, message: MAY_NOT_CHANGE_OWNER })
  })

  it("lets a Sales Admin and the Super Admin give it to anyone", () => {
    expect(() => assertMayChangeOwner({ ...base, actor: ADMIN, actorEmployeeId: "emp-7", nextOwnerId: "emp-9" })).not.toThrow()
    expect(() => assertMayChangeOwner({ ...base, actor: SUPER, actorEmployeeId: null, nextOwnerId: "emp-9" })).not.toThrow()
  })
})
