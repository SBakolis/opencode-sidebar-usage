import { describe, expect, it } from "vitest";
import { CachedProvider, type CachedProviderConfig } from "../../src/quota/cached-provider";
import type { Clock, QuotaProvider, QuotaSnapshot } from "../../src/quota/types";
import { noQuotaSnapshot } from "../../src/quota/types";

// ── Fixtures ──────────────────────────────────────────────────────────

function makeSnapshot(
  status: QuotaSnapshot["status"] = "ok",
  warningCode: string | null = null,
): QuotaSnapshot {
  if (status === "ok") {
    return {
      status: "ok",
      fetchedAt: "2026-07-17T00:00:00.000Z",
      source: "chatgpt-wham",
      planType: "plus",
      fiveHour: {
        kind: "five-hour",
        usedPercent: 37.5,
        windowSeconds: 18000,
        resetsAt: "2026-07-17T12:00:00Z",
        resetAfterSeconds: 8040,
      },
      weekly: {
        kind: "weekly",
        usedPercent: 62.3,
        windowSeconds: 604800,
        resetsAt: "2026-07-21T10:00:00Z",
        resetAfterSeconds: 345600,
      },
      unknownWindows: [],
      credits: { hasCredits: true, unlimited: false, balance: "14.50" },
      warningCode: null,
    };
  }
  return noQuotaSnapshot(status, warningCode ?? "UNAVAILABLE", "chatgpt-wham");
}

function makeClock(now: number): Clock {
  return { now: () => now };
}

function makeInner(snapshots: QuotaSnapshot[]): QuotaProvider & { calls: number } {
  let calls = 0;
  return {
    calls: 0,
    async fetch() {
      const snap = snapshots[Math.min(calls, snapshots.length - 1)];
      calls++;
      (this as { calls: number }).calls = calls;
      return snap;
    },
  } as QuotaProvider & { calls: number };
}

function makeConfig(overrides: Partial<CachedProviderConfig> = {}): CachedProviderConfig {
  return {
    ttlMs: 90_000,
    negativeTtlMs: 30_000,
    staleMaxAgeMs: 300_000,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("CachedProvider", () => {
  it("cache hit avoids a second network call", async () => {
    const inner = makeInner([makeSnapshot("ok")]);
    const provider = new CachedProvider(inner, {
      clock: makeClock(1000),
      config: makeConfig(),
    });

    await provider.fetch();
    await provider.fetch();
    await provider.fetch();

    expect(inner.calls).toBe(1);
  });

  it("concurrent calls share one request", async () => {
    const inner = makeInner([makeSnapshot("ok")]);
    const provider = new CachedProvider(inner, {
      clock: makeClock(1000),
      config: makeConfig(),
    });

    const [s1, s2, s3] = await Promise.all([provider.fetch(), provider.fetch(), provider.fetch()]);

    expect(inner.calls).toBe(1);
    expect(s1.status).toBe("ok");
    expect(s2.status).toBe("ok");
    expect(s3.status).toBe("ok");
  });

  it("cache expiry refreshes", async () => {
    let time = 1000;
    const clock: Clock = { now: () => time };
    const inner = makeInner([
      makeSnapshot("ok"),
      {
        ...makeSnapshot("ok"),
        fiveHour: { ...(makeSnapshot("ok").fiveHour as object), usedPercent: 50 },
      },
    ]);
    const provider = new CachedProvider(inner, {
      clock,
      config: makeConfig({ ttlMs: 100 }),
    });

    const s1 = await provider.fetch();
    expect(s1.fiveHour?.usedPercent).toBe(37.5);

    // Advance past TTL.
    time += 200;

    const s2 = await provider.fetch();
    expect(s2.fiveHour?.usedPercent).toBe(50);
    expect(inner.calls).toBe(2);
  });

  it("failed refresh returns marked stale data when available", async () => {
    let time = 1000;
    const clock: Clock = { now: () => time };
    const inner = makeInner([makeSnapshot("ok"), makeSnapshot("unavailable", "UNAVAILABLE")]);
    const provider = new CachedProvider(inner, {
      clock,
      config: makeConfig({ ttlMs: 100, staleMaxAgeMs: 1000 }),
    });

    // First fetch succeeds.
    const s1 = await provider.fetch();
    expect(s1.status).toBe("ok");

    // Advance past TTL.
    time += 200;

    // Second fetch fails — should return stale data.
    const s2 = await provider.fetch();
    expect(s2.status).toBe("stale");
    expect(s2.warningCode).toBe("UNAVAILABLE");
    expect(s2.fiveHour?.usedPercent).toBe(37.5); // stale data preserved
  });

  it("failed refresh returns error when no stale data available", async () => {
    const time = 1000;
    const clock: Clock = { now: () => time };
    const inner = makeInner([makeSnapshot("unavailable", "UNAVAILABLE")]);
    const provider = new CachedProvider(inner, {
      clock,
      config: makeConfig(),
    });

    const snap = await provider.fetch();
    expect(snap.status).toBe("unavailable");
    expect(snap.warningCode).toBe("UNAVAILABLE");
  });

  it("stale data beyond staleMaxAgeMs is not returned", async () => {
    let time = 1000;
    const clock: Clock = { now: () => time };
    const inner = makeInner([makeSnapshot("ok"), makeSnapshot("unavailable", "UNAVAILABLE")]);
    const provider = new CachedProvider(inner, {
      clock,
      config: makeConfig({ ttlMs: 100, staleMaxAgeMs: 500 }),
    });

    await provider.fetch(); // ok
    time += 200; // past TTL
    time += 400; // past staleMaxAgeMs (total 600 > 500)
    const s2 = await provider.fetch();
    expect(s2.status).toBe("unavailable"); // no stale fallback
  });

  it("does not cache unauthenticated for the full TTL", async () => {
    let time = 1000;
    const clock: Clock = { now: () => time };
    const inner = makeInner([makeSnapshot("unauthenticated", "AUTH_REQUIRED"), makeSnapshot("ok")]);
    const provider = new CachedProvider(inner, {
      clock,
      config: makeConfig({ ttlMs: 100_000, negativeTtlMs: 50 }),
    });

    const s1 = await provider.fetch();
    expect(s1.status).toBe("unauthenticated");

    // Within negativeTtl — should be cached.
    time += 30;
    const s2 = await provider.fetch();
    expect(s2.status).toBe("unauthenticated");
    expect(inner.calls).toBe(1);

    // Past negativeTtl — should re-fetch.
    time += 30;
    const s3 = await provider.fetch();
    expect(s3.status).toBe("ok");
    expect(inner.calls).toBe(2);
  });

  it("invalidate() forces a re-fetch on next call", async () => {
    const time = 1000;
    const clock: Clock = { now: () => time };
    const inner = makeInner([makeSnapshot("ok"), makeSnapshot("ok")]);
    const provider = new CachedProvider(inner, {
      clock,
      config: makeConfig({ ttlMs: 100_000 }),
    });

    await provider.fetch();
    expect(inner.calls).toBe(1);

    provider.invalidate();

    await provider.fetch();
    expect(inner.calls).toBe(2);
  });

  it("inner provider throwing returns unavailable (defensive)", async () => {
    const inner: QuotaProvider = {
      async fetch() {
        throw new Error("unexpected");
      },
    };
    const provider = new CachedProvider(inner, {
      clock: makeClock(1000),
      config: makeConfig(),
    });

    const snap = await provider.fetch();
    expect(snap.status).toBe("unavailable");
    expect(snap.warningCode).toBe("UNAVAILABLE");
  });
});
