import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = resolve(import.meta.dirname, "../../dist/cli/main.js");

function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      timeout: 10_000,
    });
    return { stdout, stderr: "", code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.status ?? 1,
    };
  }
}

describe("codex-meter CLI smoke", () => {
  it("--help exits 0 and prints usage to stdout", () => {
    const r = runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("codex-meter");
    expect(r.stdout).toContain("--session");
    expect(r.stdout).toContain("--quota-only");
    expect(r.stdout).toContain("EXIT CODES");
  });

  it("--version exits 0 and prints version to stdout", () => {
    const r = runCli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("no args exits 2 with usage to stderr", () => {
    const r = runCli([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Invalid arguments");
    expect(r.stderr).toContain("codex-meter");
  });

  it("unknown arg exits 2", () => {
    const r = runCli(["--bogus"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Invalid arguments");
  });

  it("--session without value exits 2", () => {
    const r = runCli(["--session"]);
    expect(r.code).toBe(2);
  });

  it("--quota-only exits 0 (quota may be unavailable but report is produced)", () => {
    const r = runCli(["--quota-only"]);
    expect(r.code).toBe(0);
    // Should have some output on stdout.
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  it("--quota-only --json exits 0 with JSON on stdout", () => {
    const r = runCli(["--quota-only", "--json"]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout.trim());
    expect(parsed.schemaVersion).toBe(1);
  });

  it("--session with unreachable server exits 3 with stderr message", () => {
    const r = runCli(["--session", "fake-session", "--server-url", "http://127.0.0.1:59999"]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("Cannot read session");
    expect(r.stderr).toContain("OpenCode server");
  });

  it("stdout and stderr are separated", () => {
    const r = runCli(["--quota-only", "--json"]);
    // stdout should be JSON only.
    JSON.parse(r.stdout.trim()); // Should not throw.
    // stderr should be empty on success.
    expect(r.stderr).toBe("");
  });
});
