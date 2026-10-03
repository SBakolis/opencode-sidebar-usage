/**
 * Loader compatibility across OpenCode plugin hosts.
 *
 * Each block mirrors how one generation of OpenCode resolves and validates
 * the built package, so a change to the export shapes cannot silently drop
 * support for a host version:
 * - < 1.3.4: imports the package directory (resolves `main`) and calls every
 *   export as a plugin function.
 * - 1.3.4–1.x: resolves `exports["./server"]` / `["./tui"]` and requires a
 *   default object with `server()` / `tui()` (not both).
 * - 2.x: resolves `exports["./server"]` / `["./tui"]` and decodes the default
 *   export as `{ id: string, setup: function }`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  main: string;
  exports: Record<string, { import: string }>;
};

const load = (file: string) =>
  import(pathToFileURL(resolve(root, file)).href) as Promise<Record<string, unknown>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isFunction = (value: unknown) => typeof value === "function";
const V2Module = Schema.Struct({
  default: Schema.Struct({ id: Schema.String, setup: Schema.declare(isFunction) }),
});

describe("OpenCode < 1.3.4 (package main)", () => {
  it("exports only plugin functions", async () => {
    const mod = await load(manifest.main);
    const exports = Object.values(mod);
    expect(exports.length).toBeGreaterThan(0);
    for (const value of exports) expect(typeof value).toBe("function");
  });

  it("exports a single function so hosts without de-duplication initialize once", async () => {
    const mod = await load(manifest.main);
    expect(new Set(Object.values(mod)).size).toBe(1);
  });

  it("does not load the V2 plugin runtime", () => {
    const source = readFileSync(resolve(root, manifest.main), "utf8");
    expect(source).not.toContain("@opencode/plugin");
  });

  it("initializes to V1 hooks", async () => {
    const { default: plugin } = await load(manifest.main);
    const original = process.env.CODEX_METER_ENABLED;
    process.env.CODEX_METER_ENABLED = "false";
    try {
      const hooks = await (plugin as (input: unknown) => Promise<unknown>)({
        client: {},
        project: {},
        worktree: "/tmp",
        directory: "/tmp",
        $: {},
      });
      expect(isRecord(hooks)).toBe(true);
    } finally {
      if (original === undefined) Reflect.deleteProperty(process.env, "CODEX_METER_ENABLED");
      else process.env.CODEX_METER_ENABLED = original;
    }
  });
});

describe("OpenCode 1.3.4–1.x (exports, V1 module)", () => {
  it("server entry default exports an object with server() and no tui()", async () => {
    const { default: value } = await load(manifest.exports["./server"].import);
    expect(isRecord(value)).toBe(true);
    const module = value as Record<string, unknown>;
    expect(typeof module.server).toBe("function");
    expect(module.tui).toBeUndefined();
    expect(typeof module.id).toBe("string");
  });

  it("tui entry default exports an object with tui() and no server()", async () => {
    const { default: value } = await load(manifest.exports["./tui"].import);
    expect(isRecord(value)).toBe(true);
    const module = value as Record<string, unknown>;
    expect(typeof module.tui).toBe("function");
    expect(module.server).toBeUndefined();
  });
});

describe("OpenCode 2.x (exports, V2 module)", () => {
  for (const entry of ["./server", "./tui"] as const) {
    it(`${entry} entry decodes as a V2 plugin definition`, async () => {
      const mod = await load(manifest.exports[entry].import);
      const decoded = Schema.decodeUnknownSync(V2Module)(mod);
      expect(decoded.default.id).toBe("opencode-codex-meter");
    });
  }
});
