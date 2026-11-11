import { vi } from "vitest"

// `emitEvent` writes notifications through `inbox.fanout`. Most service tests
// hand it a fake transaction with only `event.create`, so the fan-out is a
// no-op everywhere by default. `inbox.fanout.test.ts` calls `vi.unmock` to
// test the real one.
vi.mock("../modules/inbox/inbox.fanout", () => ({
  fanOutEvent: vi.fn(async () => {}),
  closeRequest: vi.fn(async () => {}),
  resolveUserIds: vi.fn(async () => []),
}))
