import { describe, expect, it } from "vitest";
import {
  AuthReader,
  type Clock,
  type EnvSource,
  type FsSource,
  type HomeDirProvider,
  NO_CREDENTIALS,
} from "../../src/quota/auth-reader";

// ── Test fixtures ─────────────────────────────────────────────────────

const FAKE_ACCESS = "ey_fake_access_token_12345";
const FAKE_REFRESH = "rt_fake_refresh_token_67890";
const FAKE_ACCOUNT = "acct_fake_abc123";
const FUTURE_EXPIRES = 9999999999000; // year 2286
const PAST_EXPIRES = 1000;

function openAIAuthEntry(expires: number = FUTURE_EXPIRES, accountId?: string): string {
  const entry: Record<string, unknown> = {
    type: "oauth",
    access: FAKE_ACCESS,
    refresh: FAKE_REFRESH,
    expires,
  };
  if (accountId !== undefined) {
    entry.accountId = accountId;
  }
  return JSON.stringify({ openai: entry });
}

function mixedAuthFile(): string {
  return JSON.stringify({
    openai: {
      type: "oauth",
      access: FAKE_ACCESS,
      refresh: FAKE_REFRESH,
      expires: FUTURE_EXPIRES,
      accountId: FAKE_ACCOUNT,
    },
    anthropic: { type: "api", key: "sk-ant-fake-key" },
    google: { type: "api", key: "sk-google-fake" },
  });
}

// ── Injectable doubles ────────────────────────────────────────────────

function makeEnv(env: Record<string, string | undefined>): EnvSource {
  return {
    get(key: string) {
      return env[key];
    },
  };
}

function makeFs(files: Record<string, string | null>): FsSource & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    async readFile(path: string) {
      const f = files[path];
      if (f === undefined) return null;
      return f;
    },
  };
}

function makeHome(home: string): HomeDirProvider {
  return { home: () => home };
}

function makeClock(now: number): Clock {
  return { now: () => now };
}

const FIXED_NOW = 1750000000000;

function makeReader(
  opts: {
    env?: Record<string, string | undefined>;
    files?: Record<string, string | null>;
    home?: string;
    now?: number;
    logger?: (msg: string) => void;
  } = {},
): { reader: AuthReader; fs: FsSource & { writes: string[] } } {
  const fs = makeFs(opts.files ?? {});
  const env = makeEnv(opts.env ?? {});
  const home = makeHome(opts.home ?? "/home/testuser");
  const clock = makeClock(opts.now ?? FIXED_NOW);
  return {
    reader: new AuthReader(fs, env, home, clock, opts.logger),
    fs,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("AuthReader — resolution order", () => {
  it("OPENCODE_AUTH_CONTENT takes precedence when set", async () => {
    const { reader } = makeReader({
      env: {
        OPENCODE_AUTH_CONTENT: openAIAuthEntry(FUTURE_EXPIRES, FAKE_ACCOUNT),
        CODEX_METER_AUTH_PATH: "/explicit/path",
        XDG_DATA_HOME: "/xdg",
      },
      files: {
        "/explicit/path": JSON.stringify({
          openai: {
            type: "oauth",
            access: "DIFFERENT_TOKEN",
            expires: FUTURE_EXPIRES,
            accountId: "DIFFERENT_ACCT",
          },
        }),
        "/xdg/opencode/auth.json": "should-not-be-reached",
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
    expect(creds.accessToken).toBe(FAKE_ACCESS);
    expect(creds.source).toBe("env");
  });

  it("CODEX_METER_AUTH_PATH takes precedence over XDG and default", async () => {
    const { reader } = makeReader({
      env: {
        CODEX_METER_AUTH_PATH: "/explicit/auth.json",
        XDG_DATA_HOME: "/xdg",
      },
      files: {
        "/explicit/auth.json": openAIAuthEntry(FUTURE_EXPIRES, FAKE_ACCOUNT),
        "/xdg/opencode/auth.json": "should-not-be-reached",
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
    expect(creds.source).toBe("env-path");
  });

  it("XDG_DATA_HOME resolves before default path", async () => {
    const { reader } = makeReader({
      env: { XDG_DATA_HOME: "/custom/xdg" },
      files: {
        "/custom/xdg/opencode/auth.json": openAIAuthEntry(FUTURE_EXPIRES, FAKE_ACCOUNT),
        "/home/testuser/.local/share/opencode/auth.json": "should-not-be-reached",
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
    expect(creds.source).toBe("xdg");
  });

  it("default path resolves when XDG is not set", async () => {
    const { reader } = makeReader({
      env: {},
      files: {
        "/home/testuser/.local/share/opencode/auth.json": openAIAuthEntry(
          FUTURE_EXPIRES,
          FAKE_ACCOUNT,
        ),
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
    expect(creds.source).toBe("default");
  });

  it("falls through to next source when file doesn't exist", async () => {
    const { reader } = makeReader({
      env: { XDG_DATA_HOME: "/xdg" },
      files: {
        // XDG file doesn't exist (null), default exists
        "/home/testuser/.local/share/opencode/auth.json": openAIAuthEntry(
          FUTURE_EXPIRES,
          FAKE_ACCOUNT,
        ),
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
    expect(creds.source).toBe("default");
  });

  it("falls through when OPENCODE_AUTH_CONTENT is invalid JSON", async () => {
    const { reader } = makeReader({
      env: {
        OPENCODE_AUTH_CONTENT: "{invalid json",
        XDG_DATA_HOME: "/xdg",
      },
      files: {
        "/xdg/opencode/auth.json": openAIAuthEntry(FUTURE_EXPIRES, FAKE_ACCOUNT),
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
    expect(creds.source).toBe("xdg");
  });

  it("returns NO_CREDENTIALS when no source has credentials", async () => {
    const { reader } = makeReader({ env: {}, files: {} });
    const creds = await reader.readCredentials();
    expect(creds).toBe(NO_CREDENTIALS);
    expect(creds.status).toBe("unauthenticated");
    expect(creds.source).toBe("none");
  });
});

describe("AuthReader — entry validation", () => {
  it("missing OpenAI entry returns unauthenticated", async () => {
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: JSON.stringify({ anthropic: { type: "api", key: "sk-x" } }) },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("unauthenticated");
  });

  it("non-OAuth entry (API type) returns unsupported", async () => {
    const { reader } = makeReader({
      env: {
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          openai: { type: "api", key: "sk-fake" },
        }),
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("unsupported");
  });

  it("expired credential returns expired status", async () => {
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: openAIAuthEntry(PAST_EXPIRES, FAKE_ACCOUNT) },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("expired");
    expect(creds.accessToken).toBeNull();
  });

  it("credential within 5-minute grace period is expired", async () => {
    const nearlyExpired = FIXED_NOW + 4 * 60 * 1000; // 4 minutes
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: openAIAuthEntry(nearlyExpired, FAKE_ACCOUNT) },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("expired");
  });

  it("missing account ID returns missing-account-id status", async () => {
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: openAIAuthEntry(FUTURE_EXPIRES) },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("missing-account-id");
    // Access token IS present — the quota provider decides whether to proceed.
    expect(creds.accessToken).toBe(FAKE_ACCESS);
  });

  it("malformed entry (non-object) returns malformed", async () => {
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: JSON.stringify({ openai: "not-an-object" }) },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("malformed");
  });

  it("empty access token returns malformed", async () => {
    const { reader } = makeReader({
      env: {
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          openai: { type: "oauth", access: "", refresh: FAKE_REFRESH, expires: FUTURE_EXPIRES },
        }),
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("malformed");
  });

  it("non-numeric expires returns malformed", async () => {
    const { reader } = makeReader({
      env: {
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          openai: { type: "oauth", access: FAKE_ACCESS, expires: "not-a-number" },
        }),
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("malformed");
  });
});

describe("AuthReader — security: no secret leakage", () => {
  it("refresh token is NEVER in the returned Credentials", async () => {
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: openAIAuthEntry(FUTURE_EXPIRES, FAKE_ACCOUNT) },
    });
    const creds = await reader.readCredentials();
    const credsStr = JSON.stringify(creds);
    expect(credsStr).not.toContain(FAKE_REFRESH);
    expect(credsStr).not.toContain("refresh");
  });

  it("access token is present only when status is ok or missing-account-id", async () => {
    // ok status
    const { reader: r1 } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: openAIAuthEntry(FUTURE_EXPIRES, FAKE_ACCOUNT) },
    });
    const c1 = await r1.readCredentials();
    expect(c1.accessToken).toBe(FAKE_ACCESS);

    // expired status — no access token
    const { reader: r2 } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: openAIAuthEntry(PAST_EXPIRES, FAKE_ACCOUNT) },
    });
    const c2 = await r2.readCredentials();
    expect(c2.accessToken).toBeNull();
  });

  it("logs never contain access token, refresh token, or account ID", async () => {
    const logs: string[] = [];
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: "{invalid" },
      files: {
        "/home/testuser/.local/share/opencode/auth.json": openAIAuthEntry(
          FUTURE_EXPIRES,
          FAKE_ACCOUNT,
        ),
      },
      logger: (msg) => logs.push(msg),
    });
    await reader.readCredentials();
    for (const log of logs) {
      expect(log).not.toContain(FAKE_ACCESS);
      expect(log).not.toContain(FAKE_REFRESH);
      expect(log).not.toContain(FAKE_ACCOUNT);
    }
  });

  it("error messages never contain tokens from the auth file", async () => {
    const { reader } = makeReader({
      env: {
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          openai: { type: "oauth", access: FAKE_ACCESS, refresh: FAKE_REFRESH, expires: "bad" },
        }),
      },
    });
    const creds = await reader.readCredentials();
    // Even on malformed, the credentials object must not leak the refresh token.
    expect(JSON.stringify(creds)).not.toContain(FAKE_REFRESH);
  });

  it("unrelated providers remain untouched", async () => {
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: mixedAuthFile() },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
    // Only OpenAI fields are extracted.
    expect(JSON.stringify(creds)).not.toContain("anthropic");
    expect(JSON.stringify(creds)).not.toContain("google");
    expect(JSON.stringify(creds)).not.toContain("sk-ant");
  });

  it("no write filesystem call is ever made", async () => {
    const { fs, reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: openAIAuthEntry(FUTURE_EXPIRES, FAKE_ACCOUNT) },
    });
    await reader.readCredentials();
    // FsSource only has readFile; there is no writeFile method.
    expect("writeFile" in fs).toBe(false);
    expect((fs as unknown as { writes?: unknown[] }).writes).toEqual([]);
  });
});

describe("AuthReader — additive field tolerance", () => {
  it("additive unknown fields in the openai entry are ignored", async () => {
    const { reader } = makeReader({
      env: {
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          openai: {
            type: "oauth",
            access: FAKE_ACCESS,
            refresh: FAKE_REFRESH,
            expires: FUTURE_EXPIRES,
            accountId: FAKE_ACCOUNT,
            extraField: "ignored",
            anotherField: 42,
          },
        }),
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
    expect(creds.accessToken).toBe(FAKE_ACCESS);
  });

  it("additive unknown providers are ignored", async () => {
    const { reader } = makeReader({
      env: {
        OPENCODE_AUTH_CONTENT: JSON.stringify({
          openai: {
            type: "oauth",
            access: FAKE_ACCESS,
            refresh: FAKE_REFRESH,
            expires: FUTURE_EXPIRES,
            accountId: FAKE_ACCOUNT,
          },
          newprovider: { type: "api", key: "whatever" },
          another: { foo: "bar" },
        }),
      },
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("ok");
  });
});

describe("AuthReader — non-blocking on failure", () => {
  it("returns NO_CREDENTIALS without throwing on any failure", async () => {
    const { reader } = makeReader({
      env: { OPENCODE_AUTH_CONTENT: "garbage" },
      files: {},
      home: "",
    });
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("unauthenticated");
  });

  it("readCredentials never throws", async () => {
    const fs: FsSource = {
      async readFile() {
        throw new Error("filesystem exploded");
      },
    };
    const reader = new AuthReader(fs, makeEnv({}), makeHome("/home"), makeClock(FIXED_NOW));
    const creds = await reader.readCredentials();
    expect(creds.status).toBe("unauthenticated");
  });
});
