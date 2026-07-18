/**
 * Build the TUI plugin entry point using Bun + @opentui/solid/bun-plugin.
 *
 * The TUI entry uses JSX (Solid reconciler) which tsup/esbuild can't handle.
 * Bun's build with the Solid plugin handles JSX transform correctly.
 */
import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist/tui",
  target: "bun",
  format: "esm",
  sourcemap: "external",
  minify: false,
  external: [
    "@opencode-ai/sdk",
    "@opencode-ai/plugin",
    "@opentui/core",
    "@opentui/keymap",
    "@opentui/solid",
    "solid-js",
    "zod",
  ],
  plugins: [solidPlugin],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`TUI build: ${result.outputs.length} files written to dist/tui/`);
