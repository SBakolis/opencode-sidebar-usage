#!/usr/bin/env node
/**
 * codex-meter — companion CLI for opencode-codex-meter.
 *
 * Provides a detailed report without spending a model turn. Reuses the
 * same session adapter, quota provider, report builder, and formatters
 * as the plugin.
 *
 * Exit codes:
 *   0  Report produced (including token-only when quota unavailable).
 *   2  Invalid CLI usage or configuration.
 *   3  Requested session cannot be read.
 *   4  No report section can be produced.
 */

import { createOpencodeClient } from "@opencode-ai/sdk";
import { loadConfig } from "../config";
import {
  AuthReader,
  type Clock,
  type EnvSource,
  type FsSource,
  type HomeDirProvider,
} from "../quota/auth-reader";
import { CachedProvider } from "../quota/cached-provider";
import type { HttpTransport } from "../quota/types";
import { WhamProvider } from "../quota/wham-provider";
import { buildReport } from "../report/build";
import { formatDetailed } from "../report/detailed";
import { formatJson } from "../report/json";
import { SessionStore } from "../session/aggregate";
import { type SdkMessagesResult, resultToSnapshots } from "../session/opencode-adapter";

const HELP = `codex-meter — Codex subscription and session token usage reporter

USAGE
  codex-meter --session <session-id> [--server-url <url>]
  codex-meter --session <session-id> --json
  codex-meter --quota-only
  codex-meter --help
  codex-meter --version

OPTIONS
  --session <id>        Session to report token usage for.
  --server-url <url>    OpenCode server URL (default: http://127.0.0.1:4096).
  --json                Emit machine-readable JSON on stdout.
  --quota-only          Report only Codex subscription quota, no session tokens.
  --help                Show this help text.
  --version             Show the installed version.

EXIT CODES
  0  Report produced (including token-only when quota unavailable).
  2  Invalid CLI usage or configuration.
  3  Requested session cannot be read.
  4  No report section can be produced.

This CLI is a companion to the opencode-codex-meter plugin. It does not
consume a model turn. It connects to a running OpenCode server via the
documented SDK; it does not parse internal OpenCode storage directly.
`;

const VERSION = "0.1.0";

interface CliArgs {
  sessionID: string | null;
  serverUrl: string;
  json: boolean;
  quotaOnly: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs | null {
  const args = argv.slice(2);
  const result: CliArgs = {
    sessionID: null,
    serverUrl: process.env.OPENCODE_SERVER_URL ?? "http://127.0.0.1:4096",
    json: false,
    quotaOnly: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-V") {
      result.version = true;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--quota-only") {
      result.quotaOnly = true;
    } else if (arg === "--session" || arg === "-s") {
      const val = args[i + 1];
      if (val === undefined || val.startsWith("--")) return null;
      result.sessionID = val;
      i++;
    } else if (arg === "--server-url") {
      const val = args[i + 1];
      if (val === undefined || val.startsWith("--")) return null;
      result.serverUrl = val;
      i++;
    } else {
      return null; // Unknown argument.
    }
  }

  // --quota-only doesn't need --session; everything else does.
  if (!result.quotaOnly && !result.help && !result.version && !result.sessionID) {
    return null;
  }

  return result;
}

// ── Runtime adapters (same as plugin) ─────────────────────────────────

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

function makeEnvSource(): EnvSource {
  return { get: (key: string) => process.env[key] };
}

function makeHomeDirProvider(): HomeDirProvider {
  return { home: () => process.env.HOME ?? process.env.USERPROFILE ?? "" };
}

function makeClock(): Clock {
  return { now: () => Date.now() };
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

// ── Main ──────────────────────────────────────────────────────────────

async function run(args: CliArgs): Promise<number> {
  const config = loadConfig(makeEnvSource());
  const clock = makeClock();

  // Build quota provider (shared with plugin).
  const authReader = new AuthReader(makeFsSource(), makeEnvSource(), makeHomeDirProvider(), clock);
  const wham = new WhamProvider(
    { transport: makeHttpTransport(), clock, config: { timeoutMs: config.quotaTimeoutMs } },
    () => authReader.readCredentials(),
  );
  const quotaProvider = new CachedProvider(wham, {
    clock,
    config: {
      ttlMs: config.quotaTtlMs,
      negativeTtlMs: 30_000,
      staleMaxAgeMs: config.quotaTtlMs * 4,
    },
  });

  // Fetch quota.
  let quota = null;
  try {
    quota = await quotaProvider.fetch();
  } catch {
    // Quota failure never prevents a token-only report.
  }

  // --quota-only mode: just print quota.
  if (args.quotaOnly) {
    const report = buildReport("quota-only", new Map(), quota, {
      generatedAt: new Date(clock.now()).toISOString(),
      warningThreshold: config.warningPercent,
    });
    if (args.json) {
      process.stdout.write(`${formatJson(report)}\n`);
    } else {
      process.stdout.write(formatDetailed(report));
    }
    return 0;
  }

  // --session mode: fetch session messages and build report.
  const sessionID = args.sessionID!;
  const client = createOpencodeClient({ baseUrl: args.serverUrl });

  let result: SdkMessagesResult;
  try {
    result = (await client.session.messages({ path: { id: sessionID } })) as SdkMessagesResult;
  } catch {
    process.stderr.write(`Error: Cannot read session ${sessionID} from ${args.serverUrl}.\n`);
    process.stderr.write("Is the OpenCode server running? Try: opencode serve\n");
    return 3;
  }

  if (result.error || !result.data) {
    process.stderr.write(`Error: Session ${sessionID} not found or could not be read.\n`);
    return 3;
  }

  // Aggregate tokens.
  const store = new SessionStore();
  const snapshots = resultToSnapshots(result, sessionID);
  store.replaceSession(sessionID, snapshots);
  const usage = store.getSessionUsage(sessionID);

  // Build report.
  const report = buildReport(sessionID, usage, quota, {
    generatedAt: new Date(clock.now()).toISOString(),
    warningThreshold: config.warningPercent,
  });

  // Check if we have any data.
  if (
    usage.size === 0 &&
    (!quota || quota.status === "unavailable" || quota.status === "unauthenticated")
  ) {
    process.stderr.write(
      "Error: No report section can be produced (no session tokens and no quota data).\n",
    );
    return 4;
  }

  // Output.
  if (args.json) {
    process.stdout.write(`${formatJson(report)}\n`);
  } else {
    process.stdout.write(formatDetailed(report));
  }

  return 0;
}

function main(argv: string[]): number {
  const args = parseArgs(argv);

  if (args === null) {
    process.stderr.write("Error: Invalid arguments.\n\n");
    process.stderr.write(HELP);
    return 2;
  }

  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  run(args)
    .then((code) => process.exit(code))
    .catch(() => process.exit(4));

  // The process.exit above will terminate; return 0 as a placeholder
  // for the synchronous path (the real exit happens in the .then()).
  return 0;
}

const exitCode = main(process.argv);
if (exitCode !== 0) {
  process.exit(exitCode);
}
