import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("renders reset details in a narrow sidebar and updates after quota refresh", () => {
  const output = execFileSync(
    "bun",
    ["--preload", "@opentui/solid/preload", "test/smoke/sidebar-render.tsx"],
    {
      cwd: resolve(import.meta.dirname, "../.."),
      env: { ...process.env, TZ: "UTC" },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  expect(output).toContain("Sidebar rendering and reactive updates passed.");
});
