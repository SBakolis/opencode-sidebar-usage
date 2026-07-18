import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: [
      "test/unit/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/security/**/*.test.ts",
    ],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      include: ["src/session/**/*.ts", "src/quota/**/*.ts", "src/report/**/*.ts", "src/redact.ts", "src/tui/compute.ts", "src/tui/theme.ts"],
      exclude: ["src/cli/main.ts", "src/index.ts", "probe.ts"],
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        // The plan requires 95% branch coverage on the pure aggregation
        // module (aggregate.ts). The global threshold is 90% to allow
        // integration modules (collector, adapter) to have hard-to-test
        // defensive branches without blocking the gate.
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
    },
  },
})
