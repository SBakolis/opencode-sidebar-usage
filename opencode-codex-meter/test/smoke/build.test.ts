import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("build output integrity", () => {
  it("dist/index.js exists after build", () => {
    const p = resolve(import.meta.dirname, "../../dist/index.js");
    expect(existsSync(p)).toBe(true);
  });

  it("dist/index.d.ts exists after build", () => {
    const p = resolve(import.meta.dirname, "../../dist/index.d.ts");
    expect(existsSync(p)).toBe(true);
  });

  it("dist/cli/main.js exists after build", () => {
    const p = resolve(import.meta.dirname, "../../dist/cli/main.js");
    expect(existsSync(p)).toBe(true);
  });

  it("built plugin can be dynamically imported", async () => {
    const mod = await import("../../dist/index.js");
    expect(typeof mod.CodexMeterPlugin).toBe("function");
    expect(typeof mod.default).toBe("function");
  });

  it("dist/tui/index.js exists after build", () => {
    const p = resolve(import.meta.dirname, "../../dist/tui/index.js");
    expect(existsSync(p)).toBe(true);
  });
});
