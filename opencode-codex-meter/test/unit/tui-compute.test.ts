import { describe, expect, it } from "vitest";
import { noQuotaSnapshot } from "../../src/quota/types";
import type { SdkMessage } from "../../src/session/opencode-adapter";
import { computeReport } from "../../src/tui/compute";

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
