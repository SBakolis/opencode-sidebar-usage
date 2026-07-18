import { describe, expect, it } from "vitest";
import type { Credentials } from "../../src/quota/auth-reader";
import { parseWhamResponse } from "../../src/quota/schemas";
import type { Clock, HttpResponse, HttpTransport } from "../../src/quota/types";
import { identifyWindow } from "../../src/quota/types";
import { type CredentialProvider, WhamProvider } from "../../src/quota/wham-provider";

// ── Fixtures ──────────────────────────────────────────────────────────

const FAKE_ACCESS = "ey_fake_access";
const FAKE_ACCOUNT = "acct_fake";

function goodCreds(): Credentials {
  return {
    status: "ok",
    accessToken: FAKE_ACCESS,
    expires: 9999999999000,
    accountId: FAKE_ACCOUNT,
    warningCode: null,
    source: "default",
  };
}

function makeTransport(
  responses: Array<{ status?: number; body?: unknown; ok?: boolean }>,
): HttpTransport & { calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  let idx = 0;
  return {
    calls,
    async fetch(url: string, options: { headers: Record<string, string>; signal: AbortSignal }) {
      calls.push({ url, headers: { ...options.headers } });
      const r = responses[Math.min(idx, responses.length - 1)];
      idx++;
      const status = r.status ?? 200;
      const ok = r.ok ?? (status >= 200 && status < 300);
      const body = r.body ?? {};
      const resp: HttpResponse = {
        ok,
        status,
        async json() {
          return body;
        },
        async text() {
          return typeof body === "string" ? body : JSON.stringify(body);
        },
      };
      return resp;
    },
  };
}

function makeTransportThrowing(error: Error): HttpTransport {
  return {
    async fetch() {
      throw error;
    },
  };
}

function makeClock(now: number): Clock {
  return { now: () => now };
}

function makeProvider(
  transport: HttpTransport,
  creds: Credentials = goodCreds(),
  clock: Clock = makeClock(1750000000000),
  timeoutMs = 5000,
): {
  provider: WhamProvider;
  transport: HttpTransport & { calls: Array<{ url: string; headers: Record<string, string> }> };
} {
  const credProvider: CredentialProvider = async () => creds;
  const provider = new WhamProvider({ transport, clock, config: { timeoutMs } }, credProvider);
  return {
    provider,
    transport: transport as HttpTransport & {
      calls: Array<{ url: string; headers: Record<string, string> }>;
    },
  };
}

const normalResponse = {
  windows: [
    {
      window_seconds: 18000,
      used_percent: 37.5,
      resets_at: "2026-07-17T12:00:00Z",
      reset_after_seconds: 8040,
    },
    {
      window_seconds: 604800,
      used_percent: 62.3,
      resets_at: "2026-07-21T10:00:00Z",
      reset_after_seconds: 345600,
    },
  ],
  plan_type: "plus",
  credits: { has_credits: true, unlimited: false, balance: "14.50" },
};

// ── parseWhamResponse tests ───────────────────────────────────────────

describe("parseWhamResponse", () => {
  it("parses a normal response with 5-hour and weekly windows", () => {
    const result = parseWhamResponse(normalResponse);
    expect(result.ok).toBe(true);
    expect(result.windows).toHaveLength(2);
    expect(result.windows[0].kind).toBe("five-hour");
    expect(result.windows[0].usedPercent).toBe(37.5);
    expect(result.windows[1].kind).toBe("weekly");
    expect(result.windows[1].usedPercent).toBe(62.3);
    expect(result.planType).toBe("plus");
    expect(result.credits?.balance).toBe("14.50");
  });

  it("handles primary and secondary windows swapped", () => {
    const swapped = {
      windows: [
        { window_seconds: 604800, used_percent: 62.3 },
        { window_seconds: 18000, used_percent: 37.5 },
      ],
    };
    const result = parseWhamResponse(swapped);
    expect(result.windows[0].kind).toBe("weekly");
    expect(result.windows[1].kind).toBe("five-hour");
  });

  it("handles either known window missing", () => {
    const onlyFive = { windows: [{ window_seconds: 18000, used_percent: 40 }] };
    const r1 = parseWhamResponse(onlyFive);
    expect(r1.windows.filter((w) => w.kind === "five-hour")).toHaveLength(1);
    expect(r1.windows.filter((w) => w.kind === "weekly")).toHaveLength(0);

    const onlyWeekly = { windows: [{ window_seconds: 604800, used_percent: 60 }] };
    const r2 = parseWhamResponse(onlyWeekly);
    expect(r2.windows.filter((w) => w.kind === "weekly")).toHaveLength(1);
    expect(r2.windows.filter((w) => w.kind === "five-hour")).toHaveLength(0);
  });

  it("preserves unknown-duration windows", () => {
    const withUnknown = {
      windows: [
        { window_seconds: 18000, used_percent: 37 },
        { window_seconds: 999999, used_percent: 10 },
        { window_seconds: 604800, used_percent: 62 },
      ],
    };
    const result = parseWhamResponse(withUnknown);
    expect(result.windows).toHaveLength(3);
    expect(result.windows.filter((w) => w.kind === "unknown")).toHaveLength(1);
    expect(result.windows[1].kind).toBe("unknown");
    expect(result.windows[1].windowSeconds).toBe(999999);
  });

  it("handles credits absent, unlimited, or with balance", () => {
    expect(parseWhamResponse({ windows: [] }).credits).toBeNull();

    const unlimited = parseWhamResponse({ credits: { unlimited: true } });
    expect(unlimited.credits?.unlimited).toBe(true);
    expect(unlimited.credits?.balance).toBeNull();

    const withBalance = parseWhamResponse({ credits: { balance: "14.50" } });
    expect(withBalance.credits?.balance).toBe("14.50");
    expect(withBalance.credits?.hasCredits).toBe(true);

    const numericBalance = parseWhamResponse({ credits: { balance: 14.5 } });
    expect(numericBalance.credits?.balance).toBe("14.5");
  });

  it("accepts additive response fields", () => {
    const withExtra = {
      windows: [{ window_seconds: 18000, used_percent: 37, extra_field: "ignored" }],
      plan_type: "plus",
      credits: { balance: "10", extra: true },
      unknown_top_field: 42,
    };
    const result = parseWhamResponse(withExtra);
    expect(result.ok).toBe(true);
    expect(result.windows).toHaveLength(1);
  });

  it("handles minutes instead of seconds for duration", () => {
    const inMinutes = {
      windows: [{ window_minutes: 300, used_percent: 37 }], // 300 min = 5h
    };
    const result = parseWhamResponse(inMinutes);
    expect(result.windows[0].kind).toBe("five-hour");
    expect(result.windows[0].windowSeconds).toBe(18000);
  });

  it("handles top-level array of windows", () => {
    const arr = [{ window_seconds: 18000, used_percent: 37 }];
    const result = parseWhamResponse(arr);
    expect(result.ok).toBe(true);
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].kind).toBe("five-hour");
  });

  it("handles alternative field names", () => {
    const altFields = {
      usage_windows: [
        {
          durationSeconds: 18000,
          usedPercent: 37.5,
          resetsAt: "2026-07-17T12:00:00Z",
          resetAfterSeconds: 8040,
        },
      ],
      planType: "pro",
      extra_usage: { has_credits: false, unlimited: false, balance: "0" },
    };
    const result = parseWhamResponse(altFields);
    expect(result.ok).toBe(true);
    expect(result.windows[0].kind).toBe("five-hour");
    expect(result.windows[0].usedPercent).toBe(37.5);
    expect(result.planType).toBe("pro");
    expect(result.credits?.balance).toBe("0");
  });

  it("rejects malformed JSON gracefully (non-object)", () => {
    expect(parseWhamResponse("not an object").ok).toBe(false);
    expect(parseWhamResponse(null).ok).toBe(false);
    expect(parseWhamResponse(42).ok).toBe(false);
  });

  it("parses the real wham response shape (rate_limit.primary_window / secondary_window)", () => {
    // This is the actual shape returned by https://chatgpt.com/backend-api/wham/usage
    // captured from a live plus-plan account on 2026-07-18.
    const realResponse = {
      user_id: "user-xxx",
      account_id: "user-xxx",
      email: "user@example.com",
      plan_type: "plus",
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 46,
          limit_window_seconds: 604800,
          reset_after_seconds: 595692,
          reset_at: 1784987952,
        },
        secondary_window: null,
      },
      code_review_rate_limit: null,
      additional_rate_limits: null,
      credits: {
        has_credits: false,
        unlimited: false,
        overage_limit_reached: false,
        balance: "0",
      },
      spend_control: { reached: false, individual_limit: null },
    };

    const result = parseWhamResponse(realResponse);
    expect(result.ok).toBe(true);
    expect(result.planType).toBe("plus");
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0].kind).toBe("weekly");
    expect(result.windows[0].usedPercent).toBe(46);
    expect(result.windows[0].windowSeconds).toBe(604800);
    expect(result.windows[0].resetAfterSeconds).toBe(595692);
    // reset_at is a Unix timestamp (number) → converted to ISO string.
    expect(result.windows[0].resetsAt).toBe("2026-07-25T13:59:12.000Z");
    expect(result.credits?.hasCredits).toBe(false);
    expect(result.credits?.balance).toBe("0");
  });

  it("parses real wham response with both primary and secondary windows", () => {
    const withBoth = {
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 62.3,
          limit_window_seconds: 604800,
          reset_after_seconds: 345600,
          reset_at: 1784987952,
        },
        secondary_window: {
          used_percent: 37.5,
          limit_window_seconds: 18000,
          reset_after_seconds: 8040,
          reset_at: 1784987952,
        },
      },
      credits: { has_credits: true, unlimited: false, balance: "14.50" },
    };

    const result = parseWhamResponse(withBoth);
    expect(result.ok).toBe(true);
    expect(result.planType).toBe("pro");
    expect(result.windows).toHaveLength(2);

    const weekly = result.windows.find((w) => w.kind === "weekly");
    const fiveHour = result.windows.find((w) => w.kind === "five-hour");
    expect(weekly).toBeDefined();
    expect(weekly?.usedPercent).toBe(62.3);
    expect(fiveHour).toBeDefined();
    expect(fiveHour?.usedPercent).toBe(37.5);
    expect(result.credits?.balance).toBe("14.50");
  });
});

// ── identifyWindow tests ─────────────────────────────────────────────

describe("identifyWindow", () => {
  it("identifies 5-hour window", () => {
    expect(identifyWindow(18000)).toBe("five-hour");
    expect(identifyWindow(17900)).toBe("five-hour"); // within 300s
    expect(identifyWindow(18100)).toBe("five-hour");
  });

  it("identifies weekly window", () => {
    expect(identifyWindow(604800)).toBe("weekly");
    expect(identifyWindow(603000)).toBe("weekly"); // within 3600s
    expect(identifyWindow(606000)).toBe("weekly");
  });

  it("classifies unknown durations", () => {
    expect(identifyWindow(3600)).toBe("unknown");
    expect(identifyWindow(999999)).toBe("unknown");
    expect(identifyWindow(0)).toBe("unknown");
  });
});

// ── WhamProvider tests ───────────────────────────────────────────────

describe("WhamProvider", () => {
  it("fetches and normalizes a normal response", async () => {
    const { provider, transport } = makeProvider(makeTransport([{ body: normalResponse }]));
    const snap = await provider.fetch();

    expect(snap.status).toBe("ok");
    expect(snap.source).toBe("chatgpt-wham");
    expect(snap.planType).toBe("plus");
    expect(snap.fiveHour?.kind).toBe("five-hour");
    expect(snap.fiveHour?.usedPercent).toBe(37.5);
    expect(snap.weekly?.kind).toBe("weekly");
    expect(snap.weekly?.usedPercent).toBe(62.3);
    expect(snap.credits?.balance).toBe("14.50");
    expect(snap.warningCode).toBeNull();

    // Verify request.
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].url).toBe("https://chatgpt.com/backend-api/wham/usage");
    expect(transport.calls[0].headers.Authorization).toBe(`Bearer ${FAKE_ACCESS}`);
    expect(transport.calls[0].headers["ChatGPT-Account-Id"]).toBe(FAKE_ACCOUNT);
  });

  it("returns unauthenticated on 401", async () => {
    const { provider } = makeProvider(makeTransport([{ status: 401, ok: false }]));
    const snap = await provider.fetch();
    expect(snap.status).toBe("unauthenticated");
    expect(snap.warningCode).toBe("AUTH_REQUIRED");
  });

  it("returns unauthenticated on 403", async () => {
    const { provider } = makeProvider(makeTransport([{ status: 403, ok: false }]));
    const snap = await provider.fetch();
    expect(snap.status).toBe("unauthenticated");
    expect(snap.warningCode).toBe("AUTH_REQUIRED");
  });

  it("returns unavailable on 429 (rate limited)", async () => {
    const { provider } = makeProvider(makeTransport([{ status: 429, ok: false }]));
    const snap = await provider.fetch();
    expect(snap.status).toBe("unavailable");
    expect(snap.warningCode).toBe("RATE_LIMITED");
  });

  it("returns unavailable on 5xx", async () => {
    const { provider } = makeProvider(makeTransport([{ status: 503, ok: false }]));
    const snap = await provider.fetch();
    expect(snap.status).toBe("unavailable");
    expect(snap.warningCode).toBe("UNAVAILABLE");
  });

  it("returns unavailable on network failure", async () => {
    const { provider } = makeProvider(makeTransportThrowing(new Error("ECONNREFUSED")));
    const snap = await provider.fetch();
    expect(snap.status).toBe("unavailable");
    expect(snap.warningCode).toBe("UNAVAILABLE");
  });

  it("returns unavailable on timeout (AbortError)", async () => {
    const { provider } = makeProvider(
      makeTransportThrowing(new DOMException("Aborted", "AbortError")),
    );
    const snap = await provider.fetch();
    expect(snap.status).toBe("unavailable");
    expect(snap.warningCode).toBe("TIMEOUT");
  });

  it("returns unavailable on malformed JSON", async () => {
    const transport: HttpTransport = {
      async fetch() {
        return {
          ok: true,
          status: 200,
          async json() {
            throw new Error("Invalid JSON");
          },
          async text() {
            return "not json";
          },
        };
      },
    };
    const { provider } = makeProvider(transport);
    const snap = await provider.fetch();
    expect(snap.status).toBe("unavailable");
    expect(snap.warningCode).toBe("SCHEMA_CHANGED");
  });

  it("returns unavailable on schema drift (non-object body)", async () => {
    const { provider } = makeProvider(makeTransport([{ body: "not an object" }]));
    const snap = await provider.fetch();
    expect(snap.status).toBe("unavailable");
    expect(snap.warningCode).toBe("SCHEMA_CHANGED");
  });

  it("returns unauthenticated when credentials are expired", async () => {
    const { provider } = makeProvider(makeTransport([{ body: normalResponse }]), {
      ...goodCreds(),
      status: "expired",
      accessToken: null,
    });
    const snap = await provider.fetch();
    expect(snap.status).toBe("unauthenticated");
  });

  it("returns unauthenticated when credentials are missing-account-id", async () => {
    const { provider } = makeProvider(makeTransport([{ body: normalResponse }]), {
      ...goodCreds(),
      status: "missing-account-id",
      accountId: null,
    });
    const snap = await provider.fetch();
    expect(snap.status).toBe("unauthenticated");
  });

  it("returns unsupported when credentials are API key type", async () => {
    const { provider } = makeProvider(makeTransport([{ body: normalResponse }]), {
      ...goodCreds(),
      status: "unsupported",
    });
    const snap = await provider.fetch();
    expect(snap.status).toBe("unsupported");
  });

  it("does not send ChatGPT-Account-Id header when accountId is absent but status is ok", async () => {
    // This shouldn't happen in practice (ok status requires accountId),
    // but the provider should handle it defensively.
    const { provider, transport } = makeProvider(makeTransport([{ body: normalResponse }]), {
      ...goodCreds(),
      accountId: "acct_present",
    });
    await provider.fetch();
    expect(transport.calls[0].headers["ChatGPT-Account-Id"]).toBeDefined();
  });

  it("never includes the access token in the returned snapshot", async () => {
    const { provider } = makeProvider(makeTransport([{ body: normalResponse }]));
    const snap = await provider.fetch();
    expect(JSON.stringify(snap)).not.toContain(FAKE_ACCESS);
  });
});
