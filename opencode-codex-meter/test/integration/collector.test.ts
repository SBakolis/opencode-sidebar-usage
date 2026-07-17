import { describe, expect, it } from "vitest";
import { SessionStore } from "../../src/session/aggregate";
import {
  type CollectorClient,
  type CollectorLogger,
  SessionCollector,
} from "../../src/session/collector";
import {
  type SdkEvent,
  type SdkMessage,
  type SdkMessagesResult,
  extractMessageRemoved,
  extractMessageUpdated,
  extractSessionCompacted,
  extractSessionDeleted,
  extractSessionIdle,
} from "../../src/session/opencode-adapter";
import { modelKey } from "../../src/session/types";

// ── Test fixtures ─────────────────────────────────────────────────────

function assistantMsg(
  sessionID: string,
  messageID: string,
  providerID: string,
  modelID: string,
  tokens: {
    input?: number;
    output?: number;
    reasoning?: number;
    cacheRead?: number;
    cacheWrite?: number;
  },
): SdkMessage {
  return {
    id: messageID,
    sessionID,
    role: "assistant",
    providerID,
    modelID,
    tokens: {
      input: tokens.input ?? 0,
      output: tokens.output ?? 0,
      reasoning: tokens.reasoning ?? 0,
      cache: {
        read: tokens.cacheRead ?? 0,
        write: tokens.cacheWrite ?? 0,
      },
    },
  };
}

function userMsg(sessionID: string, messageID: string): SdkMessage {
  return {
    id: messageID,
    sessionID,
    role: "user",
    model: { providerID: "openai", modelID: "gpt-5.5" } as unknown as SdkMessage["model"],
  } as SdkMessage;
}

function messagesResult(messages: SdkMessage[]): SdkMessagesResult {
  return { data: messages.map((info) => ({ info })) };
}

function event(type: string, properties: unknown): SdkEvent {
  return { type, properties };
}

function makeClient(
  messagesBySession: Map<string, SdkMessage[]>,
  errorSessions?: Set<string>,
): CollectorClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    session: {
      async messages(options: {
        path: { id: string };
      }): Promise<SdkMessagesResult> {
        const id = options.path.id;
        calls.push(id);
        if (errorSessions?.has(id)) {
          return { error: { status: 500 } };
        }
        const msgs = messagesBySession.get(id) ?? [];
        return messagesResult(msgs);
      },
    },
  };
}

const silentLogger: CollectorLogger = {
  warn: () => {},
  debug: () => {},
};

// ── Tests ─────────────────────────────────────────────────────────────

describe("SessionCollector — hydration", () => {
  it("hydrates from a realistic SDK fixture", async () => {
    const msgs = [
      userMsg("s1", "u1"),
      assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100, output: 50, reasoning: 20 }),
      assistantMsg("s1", "a2", "openai", "gpt-5.5", { input: 200, output: 80, cacheRead: 500 }),
      assistantMsg("s1", "a3", "anthropic", "claude-4", { input: 50, output: 30 }),
    ];
    const client = makeClient(new Map([["s1", msgs]]));
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    await collector.hydrate("s1");

    const usage = collector.getUsage("s1");
    expect(usage.size).toBe(2);
    const gpt = usage.get(modelKey("openai", "gpt-5.5"));
    expect(gpt?.input).toBe(300);
    expect(gpt?.output).toBe(130);
    expect(gpt?.reasoning).toBe(20);
    expect(gpt?.cacheRead).toBe(500);
    expect(gpt?.messageCount).toBe(2);

    const claude = usage.get(modelKey("anthropic", "claude-4"));
    expect(claude?.input).toBe(50);
    expect(claude?.output).toBe(30);
    expect(claude?.messageCount).toBe(1);
  });

  it("SDK response wrapper and token-field mapping is correct", async () => {
    const msgs = [
      assistantMsg("s1", "a1", "openai", "gpt-5.5", {
        input: 100,
        output: 50,
        reasoning: 20,
        cacheRead: 500,
        cacheWrite: 30,
      }),
    ];
    const client = makeClient(new Map([["s1", msgs]]));
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    await collector.hydrate("s1");
    const usage = collector.getUsage("s1");
    const mu = usage.get(modelKey("openai", "gpt-5.5"));
    expect(mu?.input).toBe(100);
    expect(mu?.output).toBe(50);
    expect(mu?.reasoning).toBe(20);
    expect(mu?.cacheRead).toBe(500);
    expect(mu?.cacheWrite).toBe(30);
  });

  it("filters out user messages", async () => {
    const msgs = [
      userMsg("s1", "u1"),
      assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 }),
    ];
    const client = makeClient(new Map([["s1", msgs]]));
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    await collector.hydrate("s1");
    expect(store.messageCount("s1")).toBe(1);
    expect(store.getSnapshot("s1", "u1")).toBeUndefined();
    expect(store.getSnapshot("s1", "a1")).toBeDefined();
  });

  it("an update arriving during hydration is not lost", async () => {
    // Control the timing of the API response.
    let resolveMessages: (r: SdkMessagesResult) => void = () => {};
    const messagesPromise = new Promise<SdkMessagesResult>((resolve) => {
      resolveMessages = resolve;
    });
    const client: CollectorClient = {
      session: {
        async messages() {
          return messagesPromise;
        },
      },
    };
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // Start hydration (doesn't resolve yet).
    const hydratePromise = collector.hydrate("s1");

    // While hydration is in flight, a message.updated event arrives
    // with newer token counts than what the API will return.
    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 999, output: 888 }),
      }),
    );

    // Now resolve the API response with OLDER data.
    resolveMessages(
      messagesResult([assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100, output: 50 })]),
    );

    await hydratePromise;

    // The event update (newer) should survive the hydration replace.
    const usage = collector.getUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(999);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.output).toBe(888);
  });

  it("a remove arriving during hydration is not lost", async () => {
    let resolveMessages: (r: SdkMessagesResult) => void = () => {};
    const messagesPromise = new Promise<SdkMessagesResult>((resolve) => {
      resolveMessages = resolve;
    });
    const client: CollectorClient = {
      session: {
        async messages() {
          return messagesPromise;
        },
      },
    };
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    const hydratePromise = collector.hydrate("s1");

    // A message.removed arrives during hydration.
    await collector.handleEvent(event("message.removed", { sessionID: "s1", messageID: "a2" }));

    // API returns both messages (a1 and a2).
    resolveMessages(
      messagesResult([
        assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 }),
        assistantMsg("s1", "a2", "openai", "gpt-5.5", { input: 200 }),
      ]),
    );

    await hydratePromise;

    // a2 should be removed despite being in the API response.
    const usage = collector.getUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(100);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.messageCount).toBe(1);
  });
});

describe("SessionCollector — event handling", () => {
  it("repeated message.updated events do not double-count", async () => {
    const client = makeClient(new Map());
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // Simulate streaming: many updates for the same message.
    for (let i = 1; i <= 10; i++) {
      await collector.handleEvent(
        event("message.updated", {
          info: assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: i * 100, output: i * 10 }),
        }),
      );
    }

    const usage = collector.getUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(1000);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.output).toBe(100);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.messageCount).toBe(1);
  });

  it("message.removed updates totals", async () => {
    const client = makeClient(new Map());
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 }),
      }),
    );
    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a2", "openai", "gpt-5.5", { input: 200 }),
      }),
    );

    expect(collector.getUsage("s1").get(modelKey("openai", "gpt-5.5"))?.input).toBe(300);

    await collector.handleEvent(event("message.removed", { sessionID: "s1", messageID: "a1" }));

    expect(collector.getUsage("s1").get(modelKey("openai", "gpt-5.5"))?.input).toBe(200);
  });

  it("idle rescan corrects missed events and reverts", async () => {
    // Start with events that set up some state.
    const msgs = [
      assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 }),
      assistantMsg("s1", "a2", "openai", "gpt-5.5", { input: 200 }),
    ];
    const client = makeClient(new Map([["s1", msgs]]));
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // Set up initial state via events.
    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 }),
      }),
    );
    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a2", "openai", "gpt-5.5", { input: 200 }),
      }),
    );
    // Manually upsert a message that's NOT in the authoritative list.
    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a-stale", "openai", "gpt-5.5", { input: 999 }),
      }),
    );
    expect(collector.getUsage("s1").get(modelKey("openai", "gpt-5.5"))?.input).toBe(1299);

    // Idle triggers authoritative rescan — a-stale is gone.
    await collector.handleEvent(event("session.idle", { sessionID: "s1" }));

    const usage = collector.getUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(300);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.messageCount).toBe(2);
  });

  it("compaction does not create duplicate totals", async () => {
    const afterCompaction = [
      assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 }),
      assistantMsg("s1", "a2", "openai", "gpt-5.5", { input: 200 }),
    ];
    // After compaction, the API returns fewer messages (the compacted summary).
    // The compaction event invalidates the old state; the next idle rescans.
    const client = makeClient(new Map([["s1", afterCompaction]]));
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // Initial state: 3 messages.
    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 }),
      }),
    );
    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a2", "openai", "gpt-5.5", { input: 200 }),
      }),
    );
    await collector.handleEvent(
      event("message.updated", {
        info: assistantMsg("s1", "a3", "openai", "gpt-5.5", { input: 300 }),
      }),
    );

    // Compaction fires.
    await collector.handleEvent(event("session.compacted", { sessionID: "s1" }));

    // Idle fires — authoritative rescan returns only a1 and a2 (a3 compacted away).
    await collector.handleEvent(event("session.idle", { sessionID: "s1" }));

    const usage = collector.getUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(300);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.messageCount).toBe(2);
  });

  it("deleted-session cleanup occurs", async () => {
    const client = makeClient(
      new Map([["s1", [assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 })]]]),
    );
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    await collector.hydrate("s1");
    expect(collector.hasSession("s1")).toBe(true);

    await collector.handleEvent(event("session.deleted", { info: { id: "s1" } }));
    expect(collector.hasSession("s1")).toBe(false);
    expect(collector.getUsage("s1").size).toBe(0);
  });

  it("SDK failure for one session does not corrupt another session", async () => {
    const s1Msgs = [assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 })];
    const s2Msgs = [assistantMsg("s2", "a2", "openai", "gpt-5.5", { input: 200 })];
    const client = makeClient(
      new Map([
        ["s1", s1Msgs],
        ["s2", s2Msgs],
      ]),
      new Set(["s1"]),
    );
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // s1 fails, s2 succeeds.
    await collector.hydrate("s1");
    await collector.hydrate("s2");

    expect(collector.hasSession("s1")).toBe(false);
    expect(collector.hasSession("s2")).toBe(true);
    expect(collector.getUsage("s2").get(modelKey("openai", "gpt-5.5"))?.input).toBe(200);
  });
});

describe("SessionCollector — deduplication", () => {
  it("concurrent idle events share one API call", async () => {
    const client = makeClient(
      new Map([["s1", [assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 })]]]),
    );
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // Fire two idle events concurrently.
    const [p1, p2] = [
      collector.handleEvent(event("session.idle", { sessionID: "s1" })),
      collector.handleEvent(event("session.idle", { sessionID: "s1" })),
    ];
    await Promise.all([p1, p2]);

    // Should have made only 1 API call (deduplicated).
    expect(client.calls.length).toBe(1);
    expect(collector.getUsage("s1").get(modelKey("openai", "gpt-5.5"))?.input).toBe(100);
  });
});

describe("SessionCollector — error resilience", () => {
  it("event handler never throws (catches errors internally)", async () => {
    const client: CollectorClient = {
      session: {
        async messages() {
          throw new Error("network failure");
        },
      },
    };
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // This should NOT throw.
    await collector.handleEvent(event("session.idle", { sessionID: "s1" }));
    expect(collector.hasSession("s1")).toBe(false);
  });

  it("malformed event properties do not crash", async () => {
    const client = makeClient(new Map());
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    await collector.handleEvent(event("message.updated", { info: null }));
    await collector.handleEvent(event("message.updated", null));
    await collector.handleEvent(event("message.removed", null));
    await collector.handleEvent(event("session.idle", null));
    await collector.handleEvent(event("session.deleted", null));
    await collector.handleEvent(event("session.compacted", null));
    await collector.handleEvent(event("unknown.event", {}));
    // No throw = pass.
  });
});

describe("SessionCollector — child session isolation", () => {
  it("child sessions remain separate from parent", async () => {
    const parentMsgs = [assistantMsg("parent", "p1", "openai", "gpt-5.5", { input: 100 })];
    const childMsgs = [assistantMsg("child", "c1", "openai", "gpt-5.5", { input: 50 })];
    const client = makeClient(
      new Map([
        ["parent", parentMsgs],
        ["child", childMsgs],
      ]),
    );
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    await collector.hydrate("parent");
    await collector.hydrate("child");

    const parentUsage = collector.getUsage("parent");
    const childUsage = collector.getUsage("child");
    expect(parentUsage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(100);
    expect(childUsage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(50);
    // Child is NOT aggregated into parent.
    expect(parentUsage.size).toBe(1);
  });
});

describe("SessionCollector — stale hydration from compaction", () => {
  it("compaction during in-flight hydration invalidates the result", async () => {
    let resolveMessages: (r: SdkMessagesResult) => void = () => {};
    const messagesPromise = new Promise<SdkMessagesResult>((resolve) => {
      resolveMessages = resolve;
    });
    const client: CollectorClient = {
      session: {
        async messages() {
          return messagesPromise;
        },
      },
    };
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // Start hydration.
    const hydratePromise = collector.hydrate("s1");

    // Compaction fires during hydration — bumps generation.
    await collector.handleEvent(event("session.compacted", { sessionID: "s1" }));

    // Now resolve the (stale) API response.
    resolveMessages(
      messagesResult([assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 })]),
    );

    await hydratePromise;

    // The stale hydration should have been discarded — store is empty
    // because compaction invalidated it and no new hydration ran.
    expect(collector.hasSession("s1")).toBe(false);
  });

  it("compaction during in-flight hydration is re-applied on next idle", async () => {
    let resolveFirst: (r: SdkMessagesResult) => void = () => {};
    const firstPromise = new Promise<SdkMessagesResult>((resolve) => {
      resolveFirst = resolve;
    });
    let callCount = 0;
    const postCompactionMsgs = [assistantMsg("s1", "a2", "openai", "gpt-5.5", { input: 200 })];
    const client: CollectorClient = {
      session: {
        async messages() {
          callCount++;
          if (callCount === 1) return firstPromise;
          return messagesResult(postCompactionMsgs);
        },
      },
    };
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    const hydratePromise = collector.hydrate("s1");
    await collector.handleEvent(event("session.compacted", { sessionID: "s1" }));
    resolveFirst(messagesResult([assistantMsg("s1", "a1", "openai", "gpt-5.5", { input: 100 })]));
    await hydratePromise;

    // Now idle fires — new hydration with post-compaction data.
    await collector.handleEvent(event("session.idle", { sessionID: "s1" }));

    const usage = collector.getUsage("s1");
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.input).toBe(200);
    expect(usage.get(modelKey("openai", "gpt-5.5"))?.messageCount).toBe(1);
  });
});

describe("SessionCollector — handleEvent catch block", () => {
  it("catches errors from store.upsert (e.g. TokenOverflowError)", async () => {
    const client = makeClient(new Map());
    const store = new SessionStore();
    const collector = new SessionCollector(client, store, { logger: silentLogger });

    // A message.updated with Infinity tokens will throw in upsert.
    await collector.handleEvent(
      event("message.updated", {
        info: {
          id: "a1",
          sessionID: "s1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5.5",
          tokens: { input: Number.POSITIVE_INFINITY },
        },
      }),
    );
    // No throw = pass. The store should not have the session.
    expect(collector.hasSession("s1")).toBe(false);
  });
});

describe("SessionCollector — getStore", () => {
  it("exposes the underlying store", () => {
    const client = makeClient(new Map());
    const store = new SessionStore();
    const collector = new SessionCollector(client, store);
    expect(collector.getStore()).toBe(store);
  });
});

describe("opencode-adapter — extractSessionDeleted fallback", () => {
  it("handles sessionID as a direct property (fallback)", () => {
    // The standard shape: properties.info.id
    expect(extractSessionDeleted(event("session.deleted", { info: { id: "s1" } }))).toBe("s1");
    // Fallback: properties.sessionID
    expect(extractSessionDeleted(event("session.deleted", { sessionID: "s1" }))).toBe("s1");
    // Null/missing
    expect(extractSessionDeleted(event("session.deleted", null))).toBeNull();
    expect(extractSessionDeleted(event("session.deleted", {}))).toBeNull();
    // Wrong type
    expect(extractSessionDeleted(event("other.event", {}))).toBeNull();
  });
});

describe("opencode-adapter — null-property handling", () => {
  it("extractMessageUpdated returns null for missing info", () => {
    expect(extractMessageUpdated(event("message.updated", null))).toBeNull();
    expect(extractMessageUpdated(event("message.updated", {}))).toBeNull();
    expect(extractMessageUpdated(event("message.updated", { info: null }))).toBeNull();
    expect(extractMessageUpdated(event("other", {}))).toBeNull();
  });

  it("extractMessageRemoved returns null for missing fields", () => {
    expect(extractMessageRemoved(event("message.removed", null))).toBeNull();
    expect(extractMessageRemoved(event("message.removed", {}))).toBeNull();
    expect(extractMessageRemoved(event("message.removed", { sessionID: "s1" }))).toBeNull();
    expect(extractMessageRemoved(event("message.removed", { messageID: "m1" }))).toBeNull();
    expect(extractMessageRemoved(event("other", {}))).toBeNull();
  });

  it("extractSessionIdle returns null for missing sessionID", () => {
    expect(extractSessionIdle(event("session.idle", null))).toBeNull();
    expect(extractSessionIdle(event("session.idle", {}))).toBeNull();
    expect(extractSessionIdle(event("other", {}))).toBeNull();
  });

  it("extractSessionCompacted returns null for missing sessionID", () => {
    expect(extractSessionCompacted(event("session.compacted", null))).toBeNull();
    expect(extractSessionCompacted(event("session.compacted", {}))).toBeNull();
    expect(extractSessionCompacted(event("other", {}))).toBeNull();
  });
});
