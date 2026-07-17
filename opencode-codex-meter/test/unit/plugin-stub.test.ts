import { describe, expect, it } from "vitest";
import { type ConfigEnv, loadConfig } from "../../src/config";
import { CodexMeterPlugin, default as defaultExport } from "../../src/index";

// ── Config tests ──────────────────────────────────────────────────────

function makeEnv(env: Record<string, string | undefined>): ConfigEnv {
  return { get: (key: string) => env[key] };
}

describe("loadConfig", () => {
  it("returns defaults when no env vars are set", () => {
    const config = loadConfig(makeEnv({}));
    expect(config.enabled).toBe(true);
    expect(config.authPath).toBeNull();
    expect(config.quotaTtlMs).toBe(90_000);
    expect(config.quotaTimeoutMs).toBe(5_000);
    expect(config.warningPercent).toBe(80);
    expect(config.debug).toBe(false);
  });

  it("parses enabled=false", () => {
    expect(loadConfig(makeEnv({ CODEX_METER_ENABLED: "false" })).enabled).toBe(false);
    expect(loadConfig(makeEnv({ CODEX_METER_ENABLED: "0" })).enabled).toBe(false);
  });

  it("parses enabled=true", () => {
    expect(loadConfig(makeEnv({ CODEX_METER_ENABLED: "true" })).enabled).toBe(true);
    expect(loadConfig(makeEnv({ CODEX_METER_ENABLED: "1" })).enabled).toBe(true);
  });

  it("falls back to default on invalid boolean", () => {
    expect(loadConfig(makeEnv({ CODEX_METER_ENABLED: "yes" })).enabled).toBe(true);
  });

  it("parses positive integers", () => {
    expect(loadConfig(makeEnv({ CODEX_METER_QUOTA_TTL_MS: "60000" })).quotaTtlMs).toBe(60_000);
    expect(loadConfig(makeEnv({ CODEX_METER_QUOTA_TIMEOUT_MS: "10000" })).quotaTimeoutMs).toBe(
      10_000,
    );
  });

  it("falls back on invalid integer", () => {
    expect(loadConfig(makeEnv({ CODEX_METER_QUOTA_TTL_MS: "abc" })).quotaTtlMs).toBe(90_000);
    expect(loadConfig(makeEnv({ CODEX_METER_QUOTA_TTL_MS: "-5" })).quotaTtlMs).toBe(90_000);
    expect(loadConfig(makeEnv({ CODEX_METER_QUOTA_TTL_MS: "0" })).quotaTtlMs).toBe(90_000);
  });

  it("parses warning percent 0-100", () => {
    expect(loadConfig(makeEnv({ CODEX_METER_WARNING_PERCENT: "90" })).warningPercent).toBe(90);
    expect(loadConfig(makeEnv({ CODEX_METER_WARNING_PERCENT: "0" })).warningPercent).toBe(0);
    expect(loadConfig(makeEnv({ CODEX_METER_WARNING_PERCENT: "100" })).warningPercent).toBe(100);
  });

  it("clamps invalid percent to default", () => {
    expect(loadConfig(makeEnv({ CODEX_METER_WARNING_PERCENT: "150" })).warningPercent).toBe(80);
    expect(loadConfig(makeEnv({ CODEX_METER_WARNING_PERCENT: "-10" })).warningPercent).toBe(80);
  });

  it("parses authPath", () => {
    expect(loadConfig(makeEnv({ CODEX_METER_AUTH_PATH: "/custom/path" })).authPath).toBe(
      "/custom/path",
    );
    expect(loadConfig(makeEnv({ CODEX_METER_AUTH_PATH: "" })).authPath).toBeNull();
  });
});

// ── Plugin factory tests ──────────────────────────────────────────────

describe("CodexMeterPlugin factory", () => {
  it("is a function", () => {
    expect(typeof CodexMeterPlugin).toBe("function");
  });

  it("default export equals named export", () => {
    expect(defaultExport).toBe(CodexMeterPlugin);
  });

  it("returns empty hooks when disabled", async () => {
    const original = process.env.CODEX_METER_ENABLED;
    process.env.CODEX_METER_ENABLED = "false";
    try {
      const hooks = await CodexMeterPlugin({} as Parameters<typeof CodexMeterPlugin>[0]);
      expect(hooks).toEqual({});
    } finally {
      if (original === undefined) {
        process.env.CODEX_METER_ENABLED = "";
      } else {
        process.env.CODEX_METER_ENABLED = original;
      }
    }
  });

  it("returns event and tool hooks when enabled", async () => {
    const original = process.env.CODEX_METER_ENABLED;
    process.env.CODEX_METER_ENABLED = "true";
    try {
      const fakeCtx = {
        client: {
          session: {
            async messages() {
              return { data: [] };
            },
          },
          app: {
            async log() {
              return { data: true };
            },
          },
        },
        directory: "/tmp/test",
      } as unknown as Parameters<typeof CodexMeterPlugin>[0];
      const hooks = await CodexMeterPlugin(fakeCtx);
      expect(hooks.event).toBeDefined();
      expect(hooks.tool).toBeDefined();
      expect(hooks.tool?.codex_usage).toBeDefined();
    } finally {
      if (original === undefined) {
        process.env.CODEX_METER_ENABLED = "";
      } else {
        process.env.CODEX_METER_ENABLED = original;
      }
    }
  });
});
