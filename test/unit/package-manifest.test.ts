import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageManifest = {
  private?: boolean;
  license?: string;
  main?: string;
  exports?: Record<string, { import?: string; types?: string }>;
  engines?: { node?: string; opencode?: string };
};

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as PackageManifest;

describe("package manifest", () => {
  it("declares separate OpenCode server and TUI targets", () => {
    expect(manifest.private).not.toBe(true);
    expect(manifest.license).toBe("MIT");
    expect(manifest.main).toBe("./dist/index.js");
    expect(manifest.engines?.node).toBe(">=20");
    expect(manifest.engines?.opencode).toBe(">=1.0.0 <2.0.0");
    expect(manifest.exports?.["."]).toEqual({
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(manifest.exports?.["./server"]).toEqual({
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(manifest.exports?.["./tui"]).toEqual({
      import: "./dist/tui/index.js",
      types: "./dist/tui/index.d.ts",
    });
  });
});
