import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "cli/main": "src/cli/main.ts",
  },
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // External: the SDK and plugin packages are runtime dependencies,
  // not bundled into dist. This avoids duplicate SDK runtimes.
  external: ["@opencode-ai/sdk", "@opencode-ai/plugin", "zod"],
  // Node.js built-ins are also external.
  noExternal: [],
});
