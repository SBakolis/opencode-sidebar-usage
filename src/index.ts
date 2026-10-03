/**
 * opencode-codex-meter — OpenCode server plugin entry point (`./server`).
 *
 * The default export serves two loaders at once:
 * - OpenCode 1.3.4–1.x reads `server` (the V1 plugin in ./plugin).
 * - OpenCode 2.x validates `{ id, setup }` and calls `setup`.
 *
 * OpenCode < 1.3.4 calls every module export as a function and cannot load
 * this object; it imports the package `main` instead (see ./legacy).
 */

import type { SessionMessageInfo } from "@opencode/client";
import { Plugin as V2Plugin } from "@opencode/plugin";
type V2Context = V2Plugin.Context;
import { type PluginConfig, loadConfig } from "./config";
import { CodexMeterPlugin } from "./plugin";
import { CachedProvider } from "./quota/cached-provider";
import { readOpenCodeCredentials } from "./quota/opencode-credentials";
import type { QuotaProvider } from "./quota/types";
import { WhamProvider } from "./quota/wham-provider";
import { buildReport } from "./report/build";
import { formatDetailed } from "./report/detailed";
import { CodexMeterRpc } from "./rpc";
import { makeClock, makeEnvSource, makeHttpTransport } from "./runtime";
import { SessionStore } from "./session/aggregate";

export { CodexMeterPlugin };

async function setupV2(ctx: V2Context): Promise<V2Plugin.Cleanup | undefined> {
  const config: PluginConfig = loadConfig(makeEnvSource());
  if (!config.enabled) return;

  const clock = makeClock();
  const wham = new WhamProvider(
    { transport: makeHttpTransport(), clock, config: { timeoutMs: config.quotaTimeoutMs } },
    () => readOpenCodeCredentials(ctx.integration.connection, clock.now()),
  );
  const quotaProvider: QuotaProvider = new CachedProvider(wham, {
    clock,
    config: {
      ttlMs: config.quotaTtlMs,
      negativeTtlMs: 30_000,
      staleMaxAgeMs: config.quotaTtlMs * 4,
    },
  });
  const rpcRegistration = await ctx.rpc.register(CodexMeterRpc, {
    quota: () => quotaProvider.fetch(),
  });
  await ctx.tool.transform((editor) => {
    editor.add({
      name: "codex_usage",
      description:
        "Report Codex subscription quota and per-model session token usage. This tool does NOT make a model call itself, but asking an agent to call it still consumes the surrounding model turn.",
      input: {
        type: "object",
        properties: {
          sessionID: {
            type: "string",
            description: "Session to report. Defaults to the current session.",
          },
        },
        additionalProperties: false,
      },
      async execute(input, toolCtx) {
        const sid = (input as { sessionID?: string }).sessionID ?? toolCtx.sessionID;
        const messages = await ctx.session.context({ sessionID: sid });
        const store = new SessionStore();
        store.replaceSession(sid, v2Snapshots(messages, sid));
        const usage = store.getSessionUsage(sid);
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
        return { content: formatDetailed(report) };
      },
    });
  });
  return () => rpcRegistration.dispose();
}

function v2Snapshots(messages: readonly SessionMessageInfo[], sessionID: string) {
  return messages.flatMap((message) => {
    if (message.type !== "assistant" || !message.tokens) return [];
    return [
      {
        sessionID,
        messageID: message.id,
        providerID: message.model.providerID,
        modelID: message.model.id,
        tokens: {
          input: message.tokens.input,
          output: message.tokens.output,
          reasoning: message.tokens.reasoning,
          cacheRead: message.tokens.cache.read,
          cacheWrite: message.tokens.cache.write,
        },
      },
    ];
  });
}

const V2Definition = V2Plugin.define({
  id: "opencode-codex-meter",
  setup: setupV2,
});

export default {
  ...V2Definition,
  server: CodexMeterPlugin,
};
