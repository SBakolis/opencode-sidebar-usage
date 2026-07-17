import { defineConfig } from "vitest/config"

// Smoke tests run against the BUILT output in dist/, after `npm run build`.
export default defineConfig({
  test: {
    include: ["test/smoke/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
})
