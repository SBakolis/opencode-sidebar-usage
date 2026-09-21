import { describe, expect, it } from "vitest";
import { type UsageWindow, noQuotaSnapshot } from "../../src/quota/types";
import type { SdkMessage } from "../../src/session/opencode-adapter";
import { computeReport, resetDurationLabel, resetPlacement } from "../../src/tui/compute";

function assistantMsg(
  id: string,
  sessionID: string,
  providerID: string,
  modelID: string,
  tokens: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  },
): SdkMessage {
  return {
    id,
    sessionID,
    role: "assistant",
    providerID,
    modelID,
    tokens,
  };
}

function userMsg(id: string, sessionID: string): SdkMessage {
  return { id, sessionID, role: "user" };
}

describe("computeReport", () => {
  it("returns empty report for no messages", () => {
    const report = computeReport("s1", [], null, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.models).toHaveLength(0);
    expect(report.sessionID).toBe("s1");
  });

  it("filters out user messages", () => {
    const msgs: SdkMessage[] = [
      userMsg("u1", "s1"),
      assistantMsg("a1", "s1", "openai", "gpt-5.5", { input: 100, output: 50 }),
    ];
    const report = computeReport("s1", msgs, null, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.models).toHaveLength(1);
    expect(report.models[0]?.input).toBe(100);
    expect(report.models[0]?.output).toBe(50);
  });

  it("aggregates multiple messages for same model", () => {
    const msgs: SdkMessage[] = [
      assistantMsg("a1", "s1", "openai", "gpt-5.5", { input: 100, output: 50 }),
      assistantMsg("a2", "s1", "openai", "gpt-5.5", { input: 200, output: 30 }),
    ];
    const report = computeReport("s1", msgs, null, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.models).toHaveLength(1);
    expect(report.models[0]?.input).toBe(300);
    expect(report.models[0]?.output).toBe(80);
    expect(report.models[0]?.messageCount).toBe(2);
  });

  it("separates different models", () => {
    const msgs: SdkMessage[] = [
      assistantMsg("a1", "s1", "openai", "gpt-5.5", { input: 100, output: 50 }),
      assistantMsg("a2", "s1", "openai", "o4-mini", { input: 200, output: 30 }),
    ];
    const report = computeReport("s1", msgs, null, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.models).toHaveLength(2);
  });

  it("sorts by totalTracked descending", () => {
    const msgs: SdkMessage[] = [
      assistantMsg("a1", "s1", "openai", "gpt-5.5", { input: 100 }),
      assistantMsg("a2", "s1", "openai", "o4-mini", { input: 500 }),
    ];
    const report = computeReport("s1", msgs, null, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.models[0]?.modelID).toBe("o4-mini");
    expect(report.models[1]?.modelID).toBe("gpt-5.5");
  });

  it("deduplicates by message ID (replace not increment)", () => {
    const msgs: SdkMessage[] = [
      assistantMsg("a1", "s1", "openai", "gpt-5.5", { input: 100 }),
      assistantMsg("a1", "s1", "openai", "gpt-5.5", { input: 200 }),
    ];
    const report = computeReport("s1", msgs, null, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.models).toHaveLength(1);
    expect(report.models[0]?.input).toBe(200);
    expect(report.models[0]?.messageCount).toBe(1);
  });

  it("includes cache tokens", () => {
    const msgs: SdkMessage[] = [
      assistantMsg("a1", "s1", "openai", "gpt-5.5", {
        input: 100,
        cache: { read: 400, write: 50 },
      }),
    ];
    const report = computeReport("s1", msgs, null, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.models[0]?.cacheRead).toBe(400);
    expect(report.models[0]?.cacheWrite).toBe(50);
  });

  it("passes quota snapshot through", () => {
    const quota = noQuotaSnapshot("unavailable", "TEST");
    const report = computeReport("s1", [], quota, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.quota).toBe(quota);
  });

  it("skips assistant messages missing providerID or modelID", () => {
    const msgs: SdkMessage[] = [
      { id: "a1", sessionID: "s1", role: "assistant", modelID: "gpt-5.5" },
      { id: "a2", sessionID: "s1", role: "assistant", providerID: "openai" },
      assistantMsg("a3", "s1", "openai", "gpt-5.5", { input: 100 }),
    ];
    const report = computeReport("s1", msgs, null, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      warningThreshold: 80,
    });
    expect(report.models).toHaveLength(1);
    expect(report.models[0]?.input).toBe(100);
  });
});

describe("resetDurationLabel", () => {
  const NOW = Date.parse("2026-09-21T12:00:00.000Z");

  function window(overrides: Partial<UsageWindow> = {}): UsageWindow {
    return {
      kind: "five-hour",
      usedPercent: 50,
      windowSeconds: 18_000,
      resetsAt: null,
      resetAfterSeconds: null,
      ...overrides,
    };
  }

  function isoAt(offsetSeconds: number): string {
    return new Date(NOW + offsetSeconds * 1000).toISOString();
  }

  it("returns null for a null window", () => {
    expect(resetDurationLabel(null, isoAt(0), NOW)).toBeNull();
  });

  it("returns null when both reset fields are null", () => {
    expect(resetDurationLabel(window(), isoAt(0), NOW)).toBeNull();
  });

  it("computes live remaining time from resetsAt, ignoring resetAfterSeconds", () => {
    const w = window({ resetsAt: isoAt(8040), resetAfterSeconds: 60 });
    expect(resetDurationLabel(w, isoAt(0), NOW)).toBe("resets 2h 14m");
  });

  it("falls back to fetchedAt + resetAfterSeconds when resetsAt is unparseable", () => {
    const w = window({ resetsAt: "not-a-date", resetAfterSeconds: 3600 });
    expect(resetDurationLabel(w, isoAt(-300), NOW)).toBe("resets 55m");
  });

  it("uses raw resetAfterSeconds when fetchedAt is unparseable", () => {
    const w = window({ resetAfterSeconds: 3600 });
    expect(resetDurationLabel(w, "garbage", NOW)).toBe("resets 1h 0m");
  });

  it("uses raw resetAfterSeconds when fetchedAt is null", () => {
    const w = window({ resetAfterSeconds: 120 });
    expect(resetDurationLabel(w, null, NOW)).toBe("resets 2m");
  });

  it("clamps past resets to 'now'", () => {
    const w = window({ resetsAt: isoAt(-10) });
    expect(resetDurationLabel(w, isoAt(-60), NOW)).toBe("resets now");
  });

  it("formats multi-day resets as days and hours", () => {
    const w = window({ kind: "weekly", resetsAt: isoAt(5 * 86_400 + 5 * 3600) });
    expect(resetDurationLabel(w, isoAt(0), NOW)).toBe("resets 5d 5h");
  });
});

describe("resetPlacement", () => {
  // Line: label(5) + 2 + bar(14) + 2 + "45%"(3) + 2 + "resets 4h 5m"(12) = 40.
  const LABEL_LEN = 5;
  const BAR_WIDTH = 14;
  const RESET = "resets 4h 5m";

  it("returns inline when the full line fits exactly", () => {
    expect(resetPlacement(LABEL_LEN, BAR_WIDTH, 45, RESET, 40)).toBe("inline");
  });

  it("returns below when one cell short", () => {
    expect(resetPlacement(LABEL_LEN, BAR_WIDTH, 45, RESET, 39)).toBe("below");
  });

  it("assumes inline when available width is unknown", () => {
    expect(resetPlacement(LABEL_LEN, BAR_WIDTH, 45, RESET, null)).toBe("inline");
  });

  it("accounts for percent digit count", () => {
    // "100%" is one cell wider than "45%" → same width now overflows.
    expect(resetPlacement(LABEL_LEN, BAR_WIDTH, 100, RESET, 40)).toBe("below");
    expect(resetPlacement(LABEL_LEN, BAR_WIDTH, 100, RESET, 41)).toBe("inline");
  });
});
