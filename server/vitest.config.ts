import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // The full suite loads ~350 files at once; route tests that import the whole
    // app can pass the 5s default under that load and fail the deploy gate.
    testTimeout: 15000,
    // Makes the notification fan-out a no-op in tests that do not test it.
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
})
