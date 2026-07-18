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

  it("built package resolves server and TUI exports", async () => {
    const server = await import("opencode-codex-meter");
    const tui = await import("opencode-codex-meter/tui");

    expect(typeof server.CodexMeterPlugin).toBe("function");
    expect(typeof server.default).toBe("function");
    expect(typeof tui.CodexMeterTuiPlugin).toBe("function");
    expect(tui.default).toEqual({ tui: tui.CodexMeterTuiPlugin });
  });

  it("dist/tui/index.js exists after build", () => {
    const p = resolve(import.meta.dirname, "../../dist/tui/index.js");
    expect(existsSync(p)).toBe(true);
  });

  it("dist/tui/index.d.ts exists after build", () => {
    const p = resolve(import.meta.dirname, "../../dist/tui/index.d.ts");
    expect(existsSync(p)).toBe(true);
  });
});
