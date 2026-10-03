import { describe, expect, it } from "vitest";
import {
  credentialsFromOpenCode,
  readOpenCodeCredentials,
} from "../../src/quota/opencode-credentials";
import { QuotaSnapshotSchema } from "../../src/rpc";

const ACCESS = "test-access-token";
const REFRESH = "test-refresh-token";
const ACCOUNT = "test-account-id";
const NOW = 1_750_000_000_000;

describe("credentialsFromOpenCode", () => {
  it("maps OpenCode OAuth metadata to quota credentials without returning refresh", () => {
    const credentials = credentialsFromOpenCode(
      {
        type: "oauth",
        methodID: "oauth",
        access: ACCESS,
        refresh: REFRESH,
        expires: NOW + 60 * 60 * 1000,
        metadata: { accountID: ACCOUNT },
      },
      NOW,
    );

    expect(credentials).toEqual({
      status: "ok",
      accessToken: ACCESS,
      expires: NOW + 60 * 60 * 1000,
      accountId: ACCOUNT,
      warningCode: null,
      source: "opencode",
    });
    expect(credentials).not.toHaveProperty("refresh");
  });

  it("marks an expired OAuth credential without exposing its tokens", () => {
    const credentials = credentialsFromOpenCode(
      {
        type: "oauth",
        methodID: "oauth",
        access: ACCESS,
        refresh: REFRESH,
        expires: NOW,
        metadata: { accountID: ACCOUNT },
      },
      NOW,
    );

    expect(credentials.status).toBe("expired");
    expect(credentials.accessToken).toBeNull();
    expect(credentials.accountId).toBeNull();
    expect(credentials).not.toHaveProperty("refresh");
  });

  it("does not treat an API key as Codex OAuth", () => {
    const credentials = credentialsFromOpenCode({ type: "key", key: "test-key" }, NOW);

    expect(credentials.status).toBe("unsupported");
    expect(credentials.accessToken).toBeNull();
    expect(credentials).not.toHaveProperty("key");
  });

  it("resolves only OpenCode's active OpenAI integration credential", async () => {
    const integrationIDs: string[] = [];
    const credentials = await readOpenCodeCredentials(
      {
        async active(integrationID) {
          integrationIDs.push(integrationID);
          return { type: "credential", id: "credential-id", label: "OpenAI", method: "oauth" };
        },
        async resolve() {
          return {
            type: "oauth",
            methodID: "oauth",
            access: ACCESS,
            refresh: REFRESH,
            expires: NOW + 60 * 60 * 1000,
            metadata: { accountID: ACCOUNT },
          };
        },
      },
      NOW,
    );

    expect(integrationIDs).toEqual(["openai"]);
    expect(credentials.status).toBe("ok");
    expect(credentials.accountId).toBe(ACCOUNT);
    expect(credentials).not.toHaveProperty("refresh");
  });

  it("allows only normalized quota data across the TUI RPC boundary", () => {
    const snapshot = {
      status: "ok",
      fetchedAt: new Date(NOW).toISOString(),
      source: "chatgpt-wham",
      planType: "plus",
      fiveHour: null,
      weekly: null,
      unknownWindows: [],
      credits: null,
      resetCredits: null,
      warningCode: null,
    };

    expect(QuotaSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(() => QuotaSnapshotSchema.parse({ ...snapshot, accessToken: ACCESS })).toThrow();
  });

  it("distinguishes integration lookup failures from missing credentials", async () => {
    const credentials = await readOpenCodeCredentials(
      {
        async active() {
          throw new Error("credential store unavailable");
        },
        async resolve() {
          return undefined;
        },
      },
      NOW,
    );

    expect(credentials.status).toBe("unavailable");
  });
});
