import { describe, expect, it } from "vitest";
import { InvalidSnapshotError, TokenOverflowError } from "../../src/errors";
import { SessionStore } from "../../src/session/aggregate";
import type { AssistantMessageSnapshot, TokenUsage } from "../../src/session/types";
import { modelKey } from "../../src/session/types";

function snap(
  sessionID: string,
  messageID: string,
  providerID: string,
  modelID: string,
  tokens: Partial<TokenUsage>,
): AssistantMessageSnapshot {
  return {
    sessionID,
    messageID,
    providerID,
    modelID,
    tokens: {
      input: tokens.input ?? 0,
      output: tokens.output ?? 0,
      reasoning: tokens.reasoning ?? 0,
      cacheRead: tokens.cacheRead ?? 0,
      cacheWrite: tokens.cacheWrite ?? 0,
    },
  };
}

describe("SessionStore — basic aggregation", () => {
  it("one message and one model", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100, output: 50 }));
    const usage = s.getSessionUsage("s1");
    expect(usage.size).toBe(1);
    const mu = usage.get(modelKey("openai", "gpt-5.5"));
    expect(mu).toBeDefined();
    expect(mu?.input).toBe(100);
    expect(mu?.output).toBe(50);
    expect(mu?.reasoning).toBe(0);
    expect(mu?.cacheRead).toBe(0);
    expect(mu?.cacheWrite).toBe(0);
    expect(mu?.messageCount).toBe(1);
  });

  it("multiple messages for one model", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100, output: 50 }));
    s.upsert(snap("s1", "m2", "openai", "gpt-5.5", { input: 200, output: 30 }));
    s.upsert(snap("s1", "m3", "openai", "gpt-5.5", { input: 50, output: 20 }));
    const usage = s.getSessionUsage("s1");
    expect(usage.size).toBe(1);
    const mu = usage.get(modelKey("openai", "gpt-5.5"));
    expect(mu?.input).toBe(350);
    expect(mu?.output).toBe(100);
    expect(mu?.messageCount).toBe(3);
  });

  it("multiple providers and models with the same model name", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    s.upsert(snap("s1", "m2", "anthropic", "gpt-5.5", { input: 200 }));
    s.upsert(snap("s1", "m3", "openai", "gpt-5.4-mini", { input: 50 }));
    const usage = s.getSessionUsage("s1");
    expect(usage.size).toBe(3);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(100);
    expect(usage.get(modelKey("anthropic", "gpt-5.5"))?.input).toBe(200);
    expect(usage.get(modelKey("openai", "gpt-5.4-mini"))?.input).toBe(50);
  });
});

describe("SessionStore — idempotency", () => {
  it("a partial message update followed by a final update does not double-count", () => {
    const s = new SessionStore();
    // Simulate streaming: partial update with 50 input, then final with 150 input.
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 50, output: 10 }));
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 150, output: 30 }));
    const usage = s.getSessionUsage("s1");
    const mu = usage.get(modelKey("openai", "gpt-5.5"));
    expect(mu?.input).toBe(150);
    expect(mu?.output).toBe(30);
    expect(mu?.messageCount).toBe(1);
  });

  it("duplicate identical updates remain idempotent", () => {
    const s = new SessionStore();
    const snapshot = snap("s1", "m1", "openai", "gpt-5.5", { input: 100, output: 50 });
    s.upsert(snapshot);
    s.upsert(snapshot);
    s.upsert(snapshot);
    const usage = s.getSessionUsage("s1");
    const mu = usage.get(modelKey("openai", "gpt-5.5"));
    expect(mu?.input).toBe(100);
    expect(mu?.output).toBe(50);
    expect(mu?.messageCount).toBe(1);
  });
});

describe("SessionStore — remove and replace", () => {
  it("removing a message subtracts its complete contribution", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    s.upsert(snap("s1", "m2", "openai", "gpt-5.5", { input: 200 }));
    expect(s.messageCount("s1")).toBe(2);
    const removed = s.remove("s1", "m1");
    expect(removed).toBe(true);
    const usage = s.getSessionUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(200);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.messageCount).toBe(1);
  });

  it("remove returns false for unknown session or message", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    expect(s.remove("s1", "m-nonexistent")).toBe(false);
    expect(s.remove("s-unknown", "m1")).toBe(false);
  });

  it("replacing a session snapshot removes messages no longer returned by OpenCode", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    s.upsert(snap("s1", "m2", "openai", "gpt-5.5", { input: 200 }));
    s.upsert(snap("s1", "m3", "openai", "gpt-5.5", { input: 300 }));
    // Rescan returns only m2 and m4 (m1 and m3 are gone).
    s.replaceSession("s1", [
      snap("s1", "m2", "openai", "gpt-5.5", { input: 250 }),
      snap("s1", "m4", "openai", "gpt-5.5", { input: 400 }),
    ]);
    const usage = s.getSessionUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(650);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.messageCount).toBe(2);
    expect(s.getSnapshot("s1", "m1")).toBeUndefined();
    expect(s.getSnapshot("s1", "m3")).toBeUndefined();
    expect(s.getSnapshot("s1", "m2")?.tokens.input).toBe(250);
    expect(s.getSnapshot("s1", "m4")?.tokens.input).toBe(400);
  });

  it("replaceSession with an empty list deletes the session", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    s.replaceSession("s1", []);
    expect(s.hasSession("s1")).toBe(false);
    expect(s.getSessionUsage("s1").size).toBe(0);
  });

  it("replaceSession filters out snapshots for other sessions", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    s.upsert(snap("s2", "m2", "openai", "gpt-5.5", { input: 200 }));
    s.replaceSession("s1", [
      snap("s1", "m1", "openai", "gpt-5.5", { input: 150 }),
      snap("s2", "m2", "openai", "gpt-5.5", { input: 999 }), // should be filtered
    ]);
    expect(s.messageCount("s1")).toBe(1);
    expect(s.getSnapshot("s1", "m1")?.tokens.input).toBe(150);
    // s2 should be untouched
    expect(s.getSnapshot("s2", "m2")?.tokens.input).toBe(200);
  });
});

describe("SessionStore — missing values become zero", () => {
  it("missing reasoning/cache values become zero", () => {
    const s = new SessionStore();
    s.upsert({
      sessionID: "s1",
      messageID: "m1",
      providerID: "openai",
      modelID: "gpt-5.5",
      tokens: { input: 100, output: 50 } as Partial<TokenUsage> as TokenUsage,
    });
    const usage = s.getSessionUsage("s1");
    const mu = usage.get(modelKey("openai", "gpt-5.5"));
    expect(mu?.input).toBe(100);
    expect(mu?.output).toBe(50);
    expect(mu?.reasoning).toBe(0);
    expect(mu?.cacheRead).toBe(0);
    expect(mu?.cacheWrite).toBe(0);
  });

  it("null tokens object normalizes to all zeros", () => {
    const s = new SessionStore();
    s.upsert({
      sessionID: "s1",
      messageID: "m1",
      providerID: "openai",
      modelID: "gpt-5.5",
      tokens: null as unknown as TokenUsage,
    });
    const usage = s.getSessionUsage("s1");
    const mu = usage.get(modelKey("openai", "gpt-5.5"));
    expect(mu?.input).toBe(0);
    expect(mu?.output).toBe(0);
    expect(mu?.reasoning).toBe(0);
    expect(mu?.cacheRead).toBe(0);
    expect(mu?.cacheWrite).toBe(0);
  });

  it("undefined token fields become zero", () => {
    const s = new SessionStore();
    s.upsert({
      sessionID: "s1",
      messageID: "m1",
      providerID: "openai",
      modelID: "gpt-5.5",
      tokens: {
        input: undefined,
        output: undefined,
        reasoning: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      } as unknown as TokenUsage,
    });
    const usage = s.getSessionUsage("s1");
    const mu = usage.get(modelKey("openai", "gpt-5.5"));
    expect(mu?.input).toBe(0);
    expect(mu?.output).toBe(0);
  });
});

describe("SessionStore — invalid and overflow values", () => {
  it("NaN normalizes to zero", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: Number.NaN, output: 50 }));
    const usage = s.getSessionUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(0);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.output).toBe(50);
  });

  it("negative values clamp to zero", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: -100, output: -50 }));
    const usage = s.getSessionUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(0);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.output).toBe(0);
  });

  it("fractional values are floored", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100.7, output: 50.2 }));
    const usage = s.getSessionUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(100);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.output).toBe(50);
  });

  it("non-numeric values (string) normalize to zero", () => {
    const s = new SessionStore();
    s.upsert({
      sessionID: "s1",
      messageID: "m1",
      providerID: "openai",
      modelID: "gpt-5.5",
      tokens: {
        input: "not-a-number",
        output: 50,
        reasoning: true,
        cacheRead: {},
        cacheWrite: [],
      } as unknown as TokenUsage,
    });
    const usage = s.getSessionUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(0);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.output).toBe(50);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.reasoning).toBe(0);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.cacheRead).toBe(0);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.cacheWrite).toBe(0);
  });

  it("Infinity throws TokenOverflowError on upsert", () => {
    const s = new SessionStore();
    expect(() =>
      s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: Number.POSITIVE_INFINITY })),
    ).toThrow(TokenOverflowError);
  });

  it("-Infinity throws TokenOverflowError on upsert", () => {
    const s = new SessionStore();
    expect(() =>
      s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { output: Number.NEGATIVE_INFINITY })),
    ).toThrow(TokenOverflowError);
  });

  it("aggregation overflow throws TokenOverflowError", () => {
    const s = new SessionStore();
    const big = Number.MAX_SAFE_INTEGER - 1;
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: big }));
    s.upsert(snap("s1", "m2", "openai", "gpt-5.5", { input: big }));
    expect(() => s.getSessionUsage("s1")).toThrow(TokenOverflowError);
  });
});

describe("SessionStore — invalid snapshots", () => {
  it("empty sessionID throws InvalidSnapshotError", () => {
    const s = new SessionStore();
    expect(() => s.upsert(snap("", "m1", "openai", "gpt-5.5", { input: 100 }))).toThrow(
      InvalidSnapshotError,
    );
  });

  it("empty messageID throws InvalidSnapshotError", () => {
    const s = new SessionStore();
    expect(() => s.upsert(snap("s1", "", "openai", "gpt-5.5", { input: 100 }))).toThrow(
      InvalidSnapshotError,
    );
  });

  it("empty providerID throws InvalidSnapshotError", () => {
    const s = new SessionStore();
    expect(() => s.upsert(snap("s1", "m1", "", "gpt-5.5", { input: 100 }))).toThrow(
      InvalidSnapshotError,
    );
  });

  it("empty modelID throws InvalidSnapshotError", () => {
    const s = new SessionStore();
    expect(() => s.upsert(snap("s1", "m1", "openai", "", { input: 100 }))).toThrow(
      InvalidSnapshotError,
    );
  });

  it("replaceSession throws on invalid snapshot in list", () => {
    const s = new SessionStore();
    expect(() =>
      s.replaceSession("s1", [snap("s1", "", "openai", "gpt-5.5", { input: 100 })]),
    ).toThrow(InvalidSnapshotError);
  });
});

describe("SessionStore — session lifecycle", () => {
  it("deleting a session releases all stored state", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    s.upsert(snap("s1", "m2", "openai", "gpt-5.5", { input: 200 }));
    s.upsert(snap("s2", "m3", "openai", "gpt-5.5", { input: 300 }));
    expect(s.hasSession("s1")).toBe(true);
    expect(s.hasSession("s2")).toBe(true);
    expect(s.sessionIDs()).toEqual(["s1", "s2"]);
    const deleted = s.deleteSession("s1");
    expect(deleted).toBe(true);
    expect(s.hasSession("s1")).toBe(false);
    expect(s.getSessionUsage("s1").size).toBe(0);
    expect(s.getSnapshot("s1", "m1")).toBeUndefined();
    // s2 is untouched
    expect(s.hasSession("s2")).toBe(true);
    expect(s.getSnapshot("s2", "m3")?.tokens.input).toBe(300);
  });

  it("deleteSession returns false for unknown session", () => {
    const s = new SessionStore();
    expect(s.deleteSession("unknown")).toBe(false);
  });

  it("messageCount returns 0 for unknown session", () => {
    const s = new SessionStore();
    expect(s.messageCount("unknown")).toBe(0);
  });

  it("hasSession returns false for unknown session", () => {
    const s = new SessionStore();
    expect(s.hasSession("unknown")).toBe(false);
  });
});

describe("SessionStore — defensive copies", () => {
  it("getSessionUsage returns a mutable copy that does not affect internal state", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    const usage1 = s.getSessionUsage("s1");
    usage1.clear();
    const usage2 = s.getSessionUsage("s1");
    expect(usage2.size).toBe(1);
    expect(usage2.get(modelKey("openai", "gpt-5.5"))?.input).toBe(100);
  });

  it("getSnapshot returns a copy that does not affect internal state", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    const snap1 = s.getSnapshot("s1", "m1");
    if (snap1) {
      snap1.tokens.input = 999;
    }
    const snap2 = s.getSnapshot("s1", "m1");
    expect(snap2?.tokens.input).toBe(100);
  });

  it("sessionIDs returns a copy that does not affect internal state", () => {
    const s = new SessionStore();
    s.upsert(snap("s1", "m1", "openai", "gpt-5.5", { input: 100 }));
    const ids1 = s.sessionIDs();
    ids1.push("fake");
    const ids2 = s.sessionIDs();
    expect(ids2).toEqual(["s1"]);
  });
});

describe("SessionStore — static helpers", () => {
  it("normalizeToken returns 0 for NaN", () => {
    expect(SessionStore.normalizeToken("input", Number.NaN)).toBe(0);
  });

  it("normalizeToken returns 0 for non-numbers", () => {
    expect(SessionStore.normalizeToken("input", "string")).toBe(0);
    expect(SessionStore.normalizeToken("input", null)).toBe(0);
    expect(SessionStore.normalizeToken("input", undefined)).toBe(0);
    expect(SessionStore.normalizeToken("input", {})).toBe(0);
  });

  it("normalizeToken returns 0 for negative", () => {
    expect(SessionStore.normalizeToken("input", -5)).toBe(0);
  });

  it("normalizeToken floors fractional", () => {
    expect(SessionStore.normalizeToken("input", 10.9)).toBe(10);
    expect(SessionStore.normalizeToken("input", 10.1)).toBe(10);
  });

  it("normalizeToken throws for Infinity", () => {
    expect(() => SessionStore.normalizeToken("input", Number.POSITIVE_INFINITY)).toThrow(
      TokenOverflowError,
    );
    expect(() => SessionStore.normalizeToken("input", Number.NEGATIVE_INFINITY)).toThrow(
      TokenOverflowError,
    );
  });

  it("isSafeInteger correctly identifies safe values", () => {
    expect(SessionStore.isSafeInteger(0)).toBe(true);
    expect(SessionStore.isSafeInteger(100)).toBe(true);
    expect(SessionStore.isSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(SessionStore.isSafeInteger(-1)).toBe(false);
    expect(SessionStore.isSafeInteger(Number.NaN)).toBe(false);
    expect(SessionStore.isSafeInteger(Number.POSITIVE_INFINITY)).toBe(false);
    expect(SessionStore.isSafeInteger(1.5)).toBe(false);
  });
});
