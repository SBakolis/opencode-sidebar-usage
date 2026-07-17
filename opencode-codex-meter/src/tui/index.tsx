/**
 * opencode-codex-meter — TUI plugin entry point.
 *
 * Wires the tested TUI modules into the OpenCode TUI plugin lifecycle:
 * - Loads config and builds the quota provider chain (same pattern as
 *   src/index.ts — duplicated because TUI and server run in separate
 *   processes and cannot share module instances).
 * - Registers a `sidebar_content` slot renderer that shows quota bars
 *   and per-model token usage for the active session.
 * - Subscribes to SDK events to keep signals fresh: message updates
 *   trigger token recompute, session.idle triggers a quota refresh.
 *
 * All failures (quota fetch, message read) are caught at boundaries and
 * never crash the TUI.
 */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { createSignal } from "solid-js";
import { type ConfigEnv, loadConfig } from "../config";
import {
  AuthReader,
  type Clock,
  type EnvSource,
  type FsSource,
  type HomeDirProvider,
} from "../quota/auth-reader";
import { CachedProvider } from "../quota/cached-provider";
import type { HttpTransport, QuotaProvider, QuotaSnapshot } from "../quota/types";
import { WhamProvider } from "../quota/wham-provider";
import type { Report } from "../report/build";
import type { SdkMessage } from "../session/opencode-adapter";
import { computeReport } from "./compute";
import { SidebarContent } from "./sidebar";
import { resolveThemeColors } from "./theme";

// ── Injectable runtime adapters ───────────────────────────────────────
// Duplicated from src/index.ts — the TUI and server entry points run in
// separate processes and intentionally do not share module instances.

function makeFsSource(): FsSource {
  return {
    async readFile(path: string): Promise<string | null> {
      try {
        const { readFile } = await import("node:fs/promises");
        return await readFile(path, "utf-8");
      } catch (e) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return null;
        throw e;
      }
    },
  };
}

function makeEnvSource(): EnvSource & ConfigEnv {
  return {
    get(key: string): string | undefined {
      return process.env[key];
    },
  };
}

function makeHomeDirProvider(): HomeDirProvider {
  return {
    home(): string {
      return process.env.HOME ?? process.env.USERPROFILE ?? "";
    },
  };
}

function makeClock(): Clock {
  return {
    now(): number {
      return Date.now();
    },
  };
}

function makeHttpTransport(): HttpTransport {
  return {
    async fetch(
      url: string,
      options: { method: string; headers: Record<string, string>; signal: AbortSignal },
    ) {
      const resp = await globalThis.fetch(url, {
        method: options.method,
        headers: options.headers,
        signal: options.signal,
      });
      return {
        ok: resp.ok,
        status: resp.status,
        json: () => resp.json(),
        text: () => resp.text(),
      };
    },
  };
}

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
  const [report, setReport] = createSignal<Report | null>(null);
  const [quota, setQuota] = createSignal<QuotaSnapshot | null>(null);
  const [sessionID, setSessionID] = createSignal<string | null>(null);

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

const tuiModule: TuiPluginModule = { tui: CodexMeterTuiPlugin };
export default tuiModule;
