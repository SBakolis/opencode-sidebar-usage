/**
 * opencode-codex-meter — TUI plugin entry point.
 *
 * Wires the tested TUI modules into the OpenCode TUI plugin lifecycle:
 * - Loads config and builds its own quota provider chain.
 * - Registers a `sidebar_content` slot renderer that shows quota bars
 *   and per-model token usage for the active session.
 * - Subscribes to SDK events to keep signals fresh: message updates
 *   trigger token recompute, session.idle triggers a quota refresh.
 *
 * All failures (quota fetch, message read) are caught at boundaries and
 * never crash the TUI.
 */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { Plugin as V2Plugin } from "@opencode/plugin/tui";
import { loadConfig } from "../config";
import { AuthReader } from "../quota/auth-reader";
import { CachedProvider } from "../quota/cached-provider";
import { type QuotaProvider, noQuotaSnapshot } from "../quota/types";
import { WhamProvider } from "../quota/wham-provider";
import { CodexMeterRpc } from "../rpc";
import {
  makeClock,
  makeEnvSource,
  makeFsSource,
  makeHomeDirProvider,
  makeHttpTransport,
} from "../runtime";
import type { SdkMessage } from "../session/opencode-adapter";
import { computeReport } from "./compute";
import { SidebarContent } from "./sidebar";
import { createTuiSignals } from "./signals";
import { resolveThemeColors } from "./theme";

// ── TUI plugin factory ───────────────────────────────────────────────

export const CodexMeterTuiPlugin: TuiPlugin = async (api, _options, _meta) => {
  const config = loadConfig(makeEnvSource());

  // Disabled plugin performs no filesystem or network work.
  if (!config.enabled) return;

  // Build credential reader + quota provider chain.
  const clock = makeClock();
  const fs = makeFsSource();
  const env = makeEnvSource();
  const home = makeHomeDirProvider();

  const authReader = new AuthReader(fs, env, home, clock, () => {});
  const transport = makeHttpTransport();
  const wham = new WhamProvider(
    { transport, clock, config: { timeoutMs: config.quotaTimeoutMs } },
    () => authReader.readCredentials(),
  );
  const quotaProvider: QuotaProvider = new CachedProvider(wham, {
    clock,
    config: {
      ttlMs: config.quotaTtlMs,
      negativeTtlMs: 30_000,
      staleMaxAgeMs: config.quotaTtlMs * 4,
    },
  });

  // Solid signals — bridge between event handlers and JSX renderers.
  const signals = createTuiSignals();
  const [report, setReport] = signals.report;
  const [quota, setQuota] = signals.quota;
  const [sessionID, setSessionID] = signals.sessionID;

  const colors = resolveThemeColors(api.theme.current, config.warningPercent);

  // ── Token recompute ────────────────────────────────────────────────

  function recomputeTokens(): void {
    const sid = sessionID();
    if (!sid) {
      setReport(null);
      return;
    }
    const messages = api.state.session.messages(sid);
    // Adapt SDK Message[] → SdkMessage[] for computeReport.
    // AssistantMessage has providerID/modelID/tokens as required fields;
    // UserMessage does not. The role discriminant narrows correctly.
    const sdkMessages: SdkMessage[] = messages.map((m): SdkMessage => {
      if (m.role === "assistant") {
        return {
          id: m.id,
          sessionID: m.sessionID,
          role: "assistant",
          providerID: m.providerID,
          modelID: m.modelID,
          tokens: {
            input: m.tokens.input,
            output: m.tokens.output,
            reasoning: m.tokens.reasoning,
            cache: { read: m.tokens.cache.read, write: m.tokens.cache.write },
          },
        };
      }
      return { id: m.id, sessionID: m.sessionID, role: "user" };
    });
    const r = computeReport(sid, sdkMessages, quota(), {
      generatedAt: new Date(clock.now()).toISOString(),
      warningThreshold: config.warningPercent,
    });
    setReport(r);
  }

  // ── Quota refresh ──────────────────────────────────────────────────

  async function refreshQuota(): Promise<void> {
    try {
      const snapshot = await quotaProvider.fetch();
      setQuota(snapshot);
      recomputeTokens();
    } catch {
      // Quota failure never prevents a token-only report.
    }
  }

  // ── Event subscriptions ───────────────────────────────────────────

  const disposers: Array<() => void> = [];

  disposers.push(
    api.event.on("session.updated", (event) => {
      const sid = event.properties.sessionID;
      if (sid !== sessionID()) {
        setSessionID(sid);
        recomputeTokens();
      }
    }),
  );

  disposers.push(api.event.on("message.part.updated", () => recomputeTokens()));
  disposers.push(api.event.on("message.updated", () => recomputeTokens()));

  disposers.push(
    api.event.on("session.idle", () => {
      recomputeTokens();
      void refreshQuota();
    }),
  );

  disposers.push(
    api.event.on("session.deleted", (event) => {
      if (event.properties.sessionID === sessionID()) {
        setSessionID(null);
        setReport(null);
      }
    }),
  );

  // ── Quota refresh interval ─────────────────────────────────────────

  const quotaInterval = setInterval(() => void refreshQuota(), config.quotaTtlMs);

  // ── Slot registration ─────────────────────────────────────────────

  api.slots.register({
    slots: {
      sidebar_content: (_ctx, props) => {
        // The slot renderer receives the active session ID from the host.
        // Sync our signal if it changed (e.g. user navigated to a session).
        if (props.session_id && props.session_id !== sessionID()) {
          setSessionID(props.session_id);
          recomputeTokens();
        }
        return <SidebarContent report={report()} sessionID={sessionID()} colors={colors} />;
      },
    },
  });

  // ── Initial state ─────────────────────────────────────────────────

  const current = api.route.current;
  if (current.name === "session") {
    const sid = current.params?.sessionID;
    if (typeof sid === "string") {
      setSessionID(sid);
      recomputeTokens();
    }
  }

  void refreshQuota();

  // ── Cleanup ───────────────────────────────────────────────────────

  api.lifecycle.onDispose(() => {
    clearInterval(quotaInterval);
    for (const d of disposers) {
      try {
        d();
      } catch {
        // Silently drop — never crash on cleanup failure.
      }
    }
  });
};

const setupV2: V2Plugin.Definition["setup"] = async (ctx) => {
  const config = loadConfig(makeEnvSource());
  if (!config.enabled) return;

  const clock = makeClock();
  const codexMeter = ctx.client.rpc(CodexMeterRpc);
  const signals = createTuiSignals();
  const [report, setReport] = signals.report;
  const [quota, setQuota] = signals.quota;
  const [sessionID, setSessionID] = signals.sessionID;
  const surface = ctx.theme.surface("dialog");
  const colors = {
    text: ctx.theme.text.base,
    textMuted: ctx.theme.text.muted,
    border: surface.border.base,
    quotaColor(percent: number) {
      if (percent >= 95) return ctx.theme.text.feedback.error.base;
      if (percent >= config.warningPercent) return ctx.theme.text.feedback.warning.base;
      return ctx.theme.text.feedback.success.base;
    },
  };

  function recomputeTokens(sid: string): void {
    const messages = ctx.data.session.message.list(sid).flatMap((message): SdkMessage[] => {
      if (message.type === "assistant") {
        return [
          {
            id: message.id,
            sessionID: sid,
            role: "assistant" as const,
            providerID: message.model.providerID,
            modelID: message.model.id,
            tokens: message.tokens ?? {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        ];
      }
      if (message.type === "user") {
        return [{ id: message.id, sessionID: sid, role: "user" as const }];
      }
      return [];
    });
    setReport(
      computeReport(sid, messages, quota(), {
        generatedAt: new Date(clock.now()).toISOString(),
        warningThreshold: config.warningPercent,
      }),
    );
  }

  async function syncMessages(sid: string): Promise<void> {
    try {
      await ctx.data.session.message.sync(sid);
      if (sid === sessionID()) recomputeTokens(sid);
    } catch {
      // A session read failure must not hide quota information.
    }
  }

  async function refreshQuota(): Promise<void> {
    try {
      setQuota(await codexMeter.quota({}));
      const sid = sessionID();
      if (sid) recomputeTokens(sid);
    } catch {
      setQuota(noQuotaSnapshot("unavailable", "UNAVAILABLE", "chatgpt-wham"));
      const sid = sessionID();
      if (sid) recomputeTokens(sid);
    }
  }

  const disposers = [
    ctx.data.on("session.usage.updated", (event) => {
      if (event.data.sessionID === sessionID()) void syncMessages(event.data.sessionID);
    }),
    ctx.data.on("session.idle", (event) => {
      if (event.data.sessionID !== sessionID()) return;
      void syncMessages(event.data.sessionID);
      void refreshQuota();
    }),
    ctx.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID: sid }) => {
        if (sid !== sessionID()) {
          setSessionID(sid);
          if (sid) void syncMessages(sid);
          else setReport(null);
        }
        return <SidebarContent report={report()} sessionID={sessionID()} colors={colors} />;
      },
    }),
  ];

  void refreshQuota();
  const quotaInterval = setInterval(() => void refreshQuota(), config.quotaTtlMs);
  return () => {
    clearInterval(quotaInterval);
    for (const dispose of disposers) dispose();
  };
};

const tuiModule: TuiPluginModule & V2Plugin.Definition = {
  id: "opencode-codex-meter",
  setup: setupV2,
  tui: CodexMeterTuiPlugin,
};
export default tuiModule;
