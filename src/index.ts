/**
 * opencode-codex-meter — OpenCode plugin entry point.
 *
 * Assembles the tested modules into the actual plugin UX:
 * - Event hook: session.idle triggers rescan via SessionCollector.
 * - Tool: codex_usage returns the detailed report.
 *
 * All subsystem failures (token collection, quota lookup, formatting)
 * are caught at boundaries and never crash OpenCode.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { Event as SdkEvent } from "@opencode-ai/sdk";
import { type PluginConfig, loadConfig } from "./config";
import { AuthReader } from "./quota/auth-reader";
import { CachedProvider } from "./quota/cached-provider";
import type { QuotaProvider } from "./quota/types";
import { WhamProvider } from "./quota/wham-provider";
import { buildReport } from "./report/build";
import { formatDetailed } from "./report/detailed";
import {
  makeClock,
  makeEnvSource,
  makeFsSource,
  makeHomeDirProvider,
  makeHttpTransport,
} from "./runtime";
import { SessionStore } from "./session/aggregate";
import { type CollectorLogger, SessionCollector } from "./session/collector";

/** Sanitized logger that writes to the OpenCode app log. */
type LogLevel = "debug" | "info" | "warn" | "error";

function makeLogger(
  client: {
    app?: {
      log?: (opts: {
        body: { service: string; level: LogLevel; message: string };
      }) => Promise<unknown>;
    };
  },
  debug: boolean,
): CollectorLogger {
  const log = (level: LogLevel, message: string) => {
    try {
      void client.app?.log?.({ body: { service: "codex-meter", level, message } });
    } catch {
      // Silently drop — never crash on logging failure.
    }
  };
  return {
    warn: (message: string) => log("warn", message),
    debug: (message: string) => {
      if (debug) log("debug", message);
    },
  };
}

// ── Plugin factory ───────────────────────────────────────────────────

export const CodexMeterPlugin: Plugin = async (ctx) => {
  const config: PluginConfig = loadConfig(makeEnvSource());

  // Disabled plugin performs no filesystem or network work.
  if (!config.enabled) {
    return {};
  }

  const clock = makeClock();
  const fs = makeFsSource();
  const env = makeEnvSource();
  const home = makeHomeDirProvider();
  const logger = makeLogger(ctx.client, config.debug);

  // Build the credential reader.
  const authReader = new AuthReader(fs, env, home, clock, (msg) => logger.warn(msg));

  // Build the quota provider chain: WhamProvider → CachedProvider.
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

  // Build the session collector.
  const store = new SessionStore();
  const collector = new SessionCollector(ctx.client, store, {
    directory: ctx.directory,
    logger,
  });

  // ── Event handler ──────────────────────────────────────────────────

  const handleEvent = async ({ event }: { event: SdkEvent }): Promise<void> => {
    // Let the collector handle all events (upsert, remove, hydrate, etc.)
    await collector.handleEvent(event);
  };

  // ── Tool registration ──────────────────────────────────────────────

  const codexUsageTool = tool({
    description:
      "Report Codex subscription quota and per-model session token usage. " +
      "This tool does NOT make a model call itself, but asking an agent to " +
      "call it still consumes the surrounding model turn.",
    args: {
      sessionID: tool.schema
        .string()
        .optional()
        .describe("Session to report. Defaults to the current session."),
    },
    async execute(args, toolCtx) {
      const sid = args.sessionID ?? toolCtx.sessionID;

      // Get session usage.
      const usage = collector.getUsage(sid);

      // Fetch quota (cached).
      let quota = null;
      try {
        quota = await quotaProvider.fetch();
      } catch {
        // Quota failure never prevents a token-only report.
      }

      const report = buildReport(sid, usage, quota, {
        generatedAt: new Date(clock.now()).toISOString(),
        warningThreshold: config.warningPercent,
      });

      return {
        title: "Codex Usage",
        output: formatDetailed(report),
      };
    },
  });

  return {
    event: handleEvent,
    tool: {
      codex_usage: codexUsageTool,
    },
  };
};

export default CodexMeterPlugin;
