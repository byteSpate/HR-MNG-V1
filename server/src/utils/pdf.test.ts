import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ active: 0, peak: 0 }))

vi.mock("puppeteer", () => ({
  default: {
    launch: async () => ({
      newPage: async () => ({
        setContent: async () => undefined,
        pdf: async () => {
          state.active += 1
          state.peak = Math.max(state.peak, state.active)
          await new Promise((resolve) => setTimeout(resolve, 15))
          state.active -= 1
          return new Uint8Array([37, 80, 68, 70])
        },
        close: async () => undefined,
      }),
      close: async () => undefined,
    }),
  },
}))

import { renderPdf } from "./pdf"

describe("renderPdf", () => {
  it("makes at most 2 PDFs at a time, however many are asked for", async () => {
    // One shared Chromium on a 512 MB dyno. Six at once would use its memory.
    const results = await Promise.all(Array.from({ length: 6 }, () => renderPdf("<p>hello</p>")))

    expect(results).toHaveLength(6)
    expect(results.every((r) => r.length === 4)).toBe(true)
    expect(state.peak).toBe(2)
  })
})
