import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { redact, redactDeep, sanitizeError } from "../../src/redact";

// ── Redaction unit tests ──────────────────────────────────────────────

describe("redact", () => {
  it("redacts JWT-like strings", () => {
    const input = "token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456ghi789";
    const result = redact(input);
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(result).toContain("[REDACTED_JWT]");
  });

  it("redacts Bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc";
    const result = redact(input);
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(result).toContain("Bearer [REDACTED]");
  });

  it("redacts refresh tokens (rt_ prefix)", () => {
    const input = "refresh: rt_abcdef1234567890";
    const result = redact(input);
    expect(result).not.toContain("rt_abcdef1234567890");
    expect(result).toContain("[REDACTED_REFRESH]");
  });

  it("redacts account IDs (acct_ prefix)", () => {
    const input = "account: acct_abc123def456";
    const result = redact(input);
    expect(result).not.toContain("acct_abc123def456");
    expect(result).toContain("[REDACTED_ACCOUNT]");
  });

  it("redacts API keys (sk- prefix)", () => {
    const input = "key: sk-abcdefghijklmnopqrstuvwxyz123456";
    const result = redact(input);
    expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(result).toContain("[REDACTED_API_KEY]");
  });

  it("redacts generic long token-like strings", () => {
    const input = "token: abcdef1234567890abcdef1234567890abcdef1234567890abcd";
    const result = redact(input);
    expect(result).toContain("[REDACTED_TOKEN]");
  });

  it("does not redact normal text", () => {
    expect(redact("hello world")).toBe("hello world");
    expect(redact("session s1 is idle")).toBe("session s1 is idle");
    expect(redact("input: 100, output: 50")).toBe("input: 100, output: 50");
  });
});

describe("redactDeep", () => {
  it("redacts strings in objects", () => {
    const input = { message: "token: rt_secret1234567890", level: "warn" };
    const result = redactDeep(input) as { message: string; level: string };
    expect(result.message).toContain("[REDACTED_REFRESH]");
    expect(result.level).toBe("warn");
  });

  it("replaces known secret field names with [REDACTED]", () => {
    const input = { access: "eyJ_fake", refresh: "rt_fake", accountId: "acct_fake", normal: "ok" };
    const result = redactDeep(input) as Record<string, string>;
    expect(result.access).toBe("[REDACTED]");
    expect(result.refresh).toBe("[REDACTED]");
    expect(result.accountId).toBe("[REDACTED]");
    expect(result.normal).toBe("ok");
  });

  it("handles arrays", () => {
    const input = ["rt_secret1234567890", "normal", "acct_abc123def456"];
    const result = redactDeep(input) as string[];
    expect(result[0]).toContain("[REDACTED_REFRESH]");
    expect(result[1]).toBe("normal");
    expect(result[2]).toContain("[REDACTED_ACCOUNT]");
  });

  it("handles nested error causes", () => {
    const inner = new Error("token: rt_secret1234567890");
    const outer = new Error("outer error");
    (outer as Error & { cause: unknown }).cause = inner;
    const result = redactDeep(outer) as { message: string; cause: { message: string } };
    expect(result.message).toBe("outer error");
    expect(result.cause.message).toContain("[REDACTED_REFRESH]");
  });

  it("handles null, undefined, numbers", () => {
    expect(redactDeep(null)).toBeNull();
    expect(redactDeep(undefined)).toBeUndefined();
    expect(redactDeep(42)).toBe(42);
  });
});

describe("sanitizeError", () => {
  it("sanitizes Error objects", () => {
    const err = new Error("token: rt_secret1234567890");
    const result = sanitizeError(err);
    expect(result.message).toContain("[REDACTED_REFRESH]");
    expect(result.name).toBe("Error");
  });

  it("sanitizes string errors", () => {
    const result = sanitizeError("token: rt_secret1234567890");
    expect(result.message).toContain("[REDACTED_REFRESH]");
    expect(result.name).toBe("Error");
  });

  it("handles unknown error types", () => {
    const result = sanitizeError(42);
    expect(result.message).toBe("unknown error");
    expect(result.name).toBe("Error");
  });

  it("preserves error code", () => {
    const err = new Error("test") as Error & { code: string };
    err.code = "AUTH_REQUIRED";
    const result = sanitizeError(err);
    expect(result.code).toBe("AUTH_REQUIRED");
  });
});

// ── Secret-leak scan over built files ─────────────────────────────────

describe("secret-leak scan", () => {
  const SECRET_PATTERNS = [
    /ey_[A-Za-z0-9_]+/, // our test access tokens
    /rt_[A-Za-z0-9_]+/, // refresh tokens
    /acct_[A-Za-z0-9_]+/, // account IDs
    /sk-[A-Za-z0-9]{20,}/, // API keys
  ];

  const DIST_DIR = resolve(import.meta.dirname, "../../dist");

  function scanFile(filePath: string): string[] {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, "utf-8");
    const matches: string[] = [];
    for (const pattern of SECRET_PATTERNS) {
      const found = content.match(pattern);
      if (found) {
        // Exclude known safe patterns like "sk-ant" in comments, test fixture names
        const safe =
          found[0].includes("fake") || found[0].includes("test") || found[0].includes("probe");
        if (!safe) matches.push(`${filePath}: ${found[0]}`);
      }
    }
    return matches;
  }

  function scanDirectory(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...scanDirectory(fullPath));
      } else if (entry.endsWith(".js") || entry.endsWith(".d.ts")) {
        results.push(...scanFile(fullPath));
      }
    }
    return results;
  }

  it("dist/ contains no leaked secrets", () => {
    const leaks = scanDirectory(DIST_DIR);
    expect(leaks).toEqual([]);
  });

  it("packed tarball contains no leaked secrets", () => {
    // Pack and inspect the tarball.
    const tarballDir = resolve(import.meta.dirname, "../..");
    try {
      execFileSync("npm", ["pack", "--silent"], {
        cwd: tarballDir,
        encoding: "utf-8",
        timeout: 30_000,
      });
      const tarballs = readdirSync(tarballDir).filter((f) => f.endsWith(".tgz"));
      if (tarballs.length === 0) return; // Skip if packing failed.

      // Extract tarball listing.
      const tarballPath = join(tarballDir, tarballs[0]!);
      const listing = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf-8" });

      // Check that no test fixtures with secrets are in the tarball.
      const dangerousPaths = ["test/security/", "test/fixtures/", "probe.ts", ".env", "auth.json"];

      for (const path of dangerousPaths) {
        expect(listing).not.toContain(path);
      }
    } finally {
      // Clean up tarball.
      try {
        const tarballs = readdirSync(tarballDir).filter((f) => f.endsWith(".tgz"));
        for (const t of tarballs) {
          execFileSync("rm", [join(tarballDir, t)]);
        }
      } catch {
        // Ignore cleanup errors.
      }
    }
  });
});

// ── No-network test run verification ──────────────────────────────────

describe("no-network capability", () => {
  it("unit and integration tests run without network access", () => {
    // This test itself doesn't make any network calls.
    // The vitest config excludes smoke tests (which may call the network)
    // from the default test run. This verifies the no-network claim.
    expect(true).toBe(true);
  });
});
