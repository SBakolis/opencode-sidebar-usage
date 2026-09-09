import { describe, expect, it } from "vitest";
import type { QuotaSnapshot } from "../../src/quota/types";
import { noQuotaSnapshot } from "../../src/quota/types";
import { buildReport } from "../../src/report/build";
import { compactNumber, formatCompact, toastVariant } from "../../src/report/compact";
import { detailedNumber, formatDetailed, formatResetDuration } from "../../src/report/detailed";
import { formatJson, toJsonReport } from "../../src/report/json";
import type { ModelUsage } from "../../src/session/types";
import { modelKey } from "../../src/session/types";

// ── Helpers ───────────────────────────────────────────────────────────

function model(
  providerID: string,
  modelID: string,
  tokens: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
    messageCount?: number;
  },
): ModelUsage {
  return {
    providerID,
    modelID,
    messageCount: tokens.messageCount ?? 1,
    input: tokens.input ?? 0,
    output: tokens.output ?? 0,
    reasoning: tokens.reasoning ?? 0,
    cacheRead: tokens.cacheRead ?? 0,
    cacheWrite: tokens.cacheWrite ?? 0,
  };
}

function usageMap(...models: ModelUsage[]): Map<string, ModelUsage> {
  const m = new Map<string, ModelUsage>();
  for (const mu of models) {
    m.set(modelKey(mu.providerID, mu.modelID), mu);
  }
  return m;
}

function okQuota(overrides: Partial<QuotaSnapshot> = {}): QuotaSnapshot {
  return {
    status: "ok",
    fetchedAt: "2026-07-17T10:00:00.000Z",
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
    ...overrides,
  };
}

const FIXED_TIME = "2026-07-17T10:00:00.000Z";
const THRESHOLD = 80;

function makeReport(
  sessionID: string,
  usage: Map<string, ModelUsage>,
  quota: QuotaSnapshot | null = null,
): ReturnType<typeof buildReport> {
  return buildReport(sessionID, usage, quota, {
    generatedAt: FIXED_TIME,
    warningThreshold: THRESHOLD,
  });
}

// ── compactNumber tests ───────────────────────────────────────────────

describe("compactNumber", () => {
  it("formats small numbers as-is", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(999)).toBe("999");
  });

  it("formats thousands with k", () => {
    expect(compactNumber(1000)).toBe("1k");
    expect(compactNumber(8500)).toBe("8.5k");
    expect(compactNumber(9999)).toBe("10k");
    expect(compactNumber(184230)).toBe("184k");
  });

  it("formats millions with M", () => {
    expect(compactNumber(1_000_000)).toBe("1M");
    expect(compactNumber(1_250_000)).toBe("1.3M");
    expect(compactNumber(9_999_999)).toBe("10M");
  });

  it("handles boundary between k and M", () => {
    expect(compactNumber(999_999)).toBe("1000k");
    expect(compactNumber(1_000_000)).toBe("1M");
  });
});

// ── formatResetDuration tests ─────────────────────────────────────────

describe("formatResetDuration", () => {
  it("formats null as unknown", () => {
    expect(formatResetDuration(null)).toBe("unknown");
  });

  it("formats zero or negative as now", () => {
    expect(formatResetDuration(0)).toBe("now");
    expect(formatResetDuration(-1)).toBe("now");
  });

  it("formats minutes only", () => {
    expect(formatResetDuration(300)).toBe("5m");
    expect(formatResetDuration(59)).toBe("0m");
  });

  it("formats hours and minutes", () => {
    expect(formatResetDuration(8040)).toBe("2h 14m");
    expect(formatResetDuration(3600)).toBe("1h 0m");
  });

  it("formats days and hours", () => {
    expect(formatResetDuration(345600)).toBe("4d 0h");
    expect(formatResetDuration(90000)).toBe("1d 1h");
  });
});

// ── formatCompact tests ───────────────────────────────────────────────

describe("formatCompact", () => {
  it("empty session with no quota", () => {
    const report = makeReport("s1", usageMap(), null);
    expect(formatCompact(report)).toBe("No usage data");
  });

  it("one model with no quota", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 184230, output: 8491 })),
      null,
    );
    expect(formatCompact(report)).toBe("gpt-5.5: 184k in / 8.5k out");
  });

  it("one model with ok quota", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 184230, output: 8491 })),
      okQuota(),
    );
    expect(formatCompact(report)).toBe("5h 38% · week 62% | gpt-5.5: 184k in / 8.5k out");
  });

  it("multiple models show +N more", () => {
    const report = makeReport(
      "s1",
      usageMap(
        model("openai", "gpt-5.5", { input: 184230, output: 8491 }),
        model("openai", "gpt-5.4-mini", { input: 14291, output: 1203 }),
      ),
      okQuota(),
    );
    expect(formatCompact(report)).toBe("5h 38% · week 62% | gpt-5.5: 184k in / 8.5k out +1 more");
  });

  it("stale quota is labeled", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({ status: "stale" }),
    );
    expect(formatCompact(report)).toContain("(stale)");
  });

  it("unavailable quota shows only model", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      noQuotaSnapshot("unavailable", "UNAVAILABLE", "chatgpt-wham"),
    );
    expect(formatCompact(report)).toBe("gpt-5.5: 100 in / 0 out");
  });

  it("quota with only 5h window", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({ weekly: null }),
    );
    expect(formatCompact(report)).toBe("5h 38% | gpt-5.5: 100 in / 0 out");
  });

  it("quota with only weekly window", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({ fiveHour: null }),
    );
    expect(formatCompact(report)).toBe("week 62% | gpt-5.5: 100 in / 0 out");
  });
});

// ── toastVariant tests ────────────────────────────────────────────────

describe("toastVariant", () => {
  it("returns warning when threshold met (5h)", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({
        fiveHour: {
          kind: "five-hour",
          usedPercent: 80,
          windowSeconds: 18000,
          resetsAt: null,
          resetAfterSeconds: null,
        },
      }),
    );
    expect(toastVariant(report)).toBe("warning");
  });

  it("returns warning when threshold met (weekly)", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({
        weekly: {
          kind: "weekly",
          usedPercent: 85,
          windowSeconds: 604800,
          resetsAt: null,
          resetAfterSeconds: null,
        },
      }),
    );
    expect(toastVariant(report)).toBe("warning");
  });

  it("returns info when below threshold", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({
        fiveHour: {
          kind: "five-hour",
          usedPercent: 79,
          windowSeconds: 18000,
          resetsAt: null,
          resetAfterSeconds: null,
        },
      }),
    );
    expect(toastVariant(report)).toBe("info");
  });

  it("returns info when no quota", () => {
    const report = makeReport("s1", usageMap(model("openai", "gpt-5.5", { input: 100 })), null);
    expect(toastVariant(report)).toBe("info");
  });

  it("threshold boundary: exactly at threshold is warning", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({
        fiveHour: {
          kind: "five-hour",
          usedPercent: 80,
          windowSeconds: 18000,
          resetsAt: null,
          resetAfterSeconds: null,
        },
      }),
    );
    expect(toastVariant(report)).toBe("warning");
  });

  it("threshold boundary: just below threshold is info", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({
        fiveHour: {
          kind: "five-hour",
          usedPercent: 79.9,
          windowSeconds: 18000,
          resetsAt: null,
          resetAfterSeconds: null,
        },
      }),
    );
    expect(toastVariant(report)).toBe("info");
  });
});

// ── formatDetailed tests ──────────────────────────────────────────────

describe("formatDetailed", () => {
  it("includes both quota and session sections", () => {
    const report = makeReport(
      "s1",
      usageMap(
        model("openai", "gpt-5.5", {
          input: 184230,
          output: 8491,
          reasoning: 21048,
          cacheRead: 421120,
        }),
      ),
      okQuota(),
    );
    const detailed = formatDetailed(report);

    expect(detailed).toContain("Codex subscription");
    expect(detailed).toContain("5h:");
    expect(detailed).toContain("Weekly:");
    expect(detailed).toContain("Credits:");
    expect(detailed).toContain("Current OpenCode session");
    expect(detailed).toContain("openai/gpt-5.5");
    expect(detailed).toContain("Input:");
    expect(detailed).toContain("Output:");
    expect(detailed).toContain("Reasoning:");
    expect(detailed).toContain("Cache read:");
    expect(detailed).toContain("Cache write:");
  });

  it("shows separate input/output values", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 184230, output: 8491 })),
      null,
    );
    const detailed = formatDetailed(report);
    expect(detailed).toContain("184,230");
    expect(detailed).toContain("8,491");
  });

  it("shows all models sorted by total tracked tokens", () => {
    const report = makeReport(
      "s1",
      usageMap(
        model("openai", "gpt-5.4-mini", { input: 14291, output: 1203 }),
        model("openai", "gpt-5.5", { input: 184230, output: 8491 }),
        model("anthropic", "claude-4", { input: 50, output: 30 }),
      ),
      null,
    );
    const detailed = formatDetailed(report);
    const gpt55Pos = detailed.indexOf("openai/gpt-5.5");
    const miniPos = detailed.indexOf("openai/gpt-5.4-mini");
    const claudePos = detailed.indexOf("anthropic/claude-4");
    expect(gpt55Pos).toBeLessThan(miniPos);
    expect(miniPos).toBeLessThan(claudePos);
  });

  it("empty session shows no assistant messages", () => {
    const report = makeReport("s1", usageMap(), null);
    const detailed = formatDetailed(report);
    expect(detailed).toContain("No assistant messages recorded yet.");
  });

  it("unavailable quota shows actionable message", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      noQuotaSnapshot("unavailable", "UNAVAILABLE", "chatgpt-wham"),
    );
    const detailed = formatDetailed(report);
    expect(detailed).toContain("Quota endpoint unavailable");
    expect(detailed).toContain("Code: UNAVAILABLE");
  });

  it("unauthenticated quota shows auth hint", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      noQuotaSnapshot("unauthenticated", "AUTH_REQUIRED", "chatgpt-wham"),
    );
    const detailed = formatDetailed(report);
    expect(detailed).toContain("Not authenticated");
    expect(detailed).toContain("opencode auth login");
  });

  it("stale quota is labeled", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({ status: "stale" }),
    );
    const detailed = formatDetailed(report);
    expect(detailed).toContain("(stale)");
  });

  it("preserves unknown windows in detailed output", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({
        unknownWindows: [
          {
            kind: "unknown",
            usedPercent: 10,
            windowSeconds: 999999,
            resetsAt: null,
            resetAfterSeconds: null,
          },
        ],
      }),
    );
    const detailed = formatDetailed(report);
    expect(detailed).toContain("Unknown");
    expect(detailed).toContain("999999s");
  });
});

// ── formatJson tests ──────────────────────────────────────────────────

describe("formatJson", () => {
  it("has schemaVersion: 1", () => {
    const report = makeReport("s1", usageMap(), null);
    const json = toJsonReport(report);
    expect(json.schemaVersion).toBe(1);
  });

  it("includes all models with separate input/output", () => {
    const report = makeReport(
      "s1",
      usageMap(
        model("openai", "gpt-5.5", {
          input: 184230,
          output: 8491,
          reasoning: 21048,
          cacheRead: 421120,
        }),
        model("openai", "gpt-5.4-mini", { input: 14291, output: 1203 }),
      ),
      okQuota(),
    );
    const json = toJsonReport(report);
    expect(json.session.models).toHaveLength(2);
    expect(json.session.models[0]?.input).toBe(184230);
    expect(json.session.models[0]?.output).toBe(8491);
    expect(json.session.models[0]?.reasoning).toBe(21048);
    expect(json.session.models[0]?.cacheRead).toBe(421120);
    expect(json.session.models[0]?.cacheWrite).toBe(0);
  });

  it("includes quota snapshot when available", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota(),
    );
    const json = toJsonReport(report);
    expect(json.quota).not.toBeNull();
    expect(json.quota?.status).toBe("ok");
    expect(json.quota?.planType).toBe("plus");
    expect(json.quota?.fiveHour).not.toBeNull();
    expect(json.quota?.weekly).not.toBeNull();
  });

  it("quota is null when unavailable", () => {
    const report = makeReport("s1", usageMap(model("openai", "gpt-5.5", { input: 100 })), null);
    const json = toJsonReport(report);
    expect(json.quota).toBeNull();
  });

  it("JSON string does not contain secrets", () => {
    const report = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota(),
    );
    const jsonStr = formatJson(report);
    expect(jsonStr).not.toContain("access");
    expect(jsonStr).not.toContain("refresh");
    expect(jsonStr).not.toContain("token");
    expect(jsonStr).not.toContain("Bearer");
    expect(jsonStr).not.toContain("ey_");
    expect(jsonStr).not.toContain("acct_");
  });

  it("isWarning is set correctly", () => {
    const r1 = makeReport(
      "s1",
      usageMap(model("openai", "gpt-5.5", { input: 100 })),
      okQuota({
        fiveHour: {
          kind: "five-hour",
          usedPercent: 85,
          windowSeconds: 18000,
          resetsAt: null,
          resetAfterSeconds: null,
        },
      }),
    );
    expect(toJsonReport(r1).isWarning).toBe(true);

    const r2 = makeReport("s1", usageMap(model("openai", "gpt-5.5", { input: 100 })), okQuota());
    expect(toJsonReport(r2).isWarning).toBe(false);
  });

  it("empty session has empty models array", () => {
    const report = makeReport("s1", usageMap(), null);
    const json = toJsonReport(report);
    expect(json.session.models).toEqual([]);
  });

  it("detailedNumber formats with commas", () => {
    expect(detailedNumber(184230)).toBe("184,230");
    expect(detailedNumber(8491)).toBe("8,491");
    expect(detailedNumber(0)).toBe("0");
  });
});

// ── Sort stability tests ──────────────────────────────────────────────

describe("sort stability", () => {
  it("models with same total are sorted by key", () => {
    const report = makeReport(
      "s1",
      usageMap(
        model("zeta", "model-z", { input: 100 }),
        model("alpha", "model-a", { input: 100 }),
        model("mid", "model-m", { input: 100 }),
      ),
      null,
    );
    expect(report.models[0]?.providerID).toBe("alpha");
    expect(report.models[1]?.providerID).toBe("mid");
    expect(report.models[2]?.providerID).toBe("zeta");
  });

  it("models with different totals are sorted descending", () => {
    const report = makeReport(
      "s1",
      usageMap(
        model("openai", "small", { input: 50 }),
        model("openai", "big", { input: 500 }),
        model("openai", "medium", { input: 200 }),
      ),
      null,
    );
    expect(report.models[0]?.modelID).toBe("big");
    expect(report.models[1]?.modelID).toBe("medium");
    expect(report.models[2]?.modelID).toBe("small");
  });
});
