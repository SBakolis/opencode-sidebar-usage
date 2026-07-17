# OpenCode Compatibility Reference

This document records every OpenCode SDK / plugin / auth contract that
`opencode-codex-meter` depends on, the exact version verified, the source
permalink or captured type fixture, and known compatibility risks. Every
production module must depend only on contracts listed here.

## Compatibility Decision Table

```text
Official usage API available: NO
Selected quota provider: wham (https://chatgpt.com/backend-api/wham/usage)
Supported OpenCode version range: @opencode-ai/plugin and @opencode-ai/sdk 1.18.x
Assistant token source: AssistantMessage.tokens { input, output, reasoning, cache: { read, write } }
Current session ID source for plugin tool: ToolContext.sessionID (string)
Auth provider key and credential source: file at $XDG_DATA_HOME/opencode/auth.json keyed by provider id (e.g. "openai")
Known compatibility risks: OPENCODE_AUTH_CONTENT unverifiable; OAuth.accountId present in AuthOAuthResult but absent from published v1 Auth type; wham endpoint unsupported
```

## Pinned Dependencies

| Package                  | Version | Published (UTC)         | Source |
| ------------------------ | ------- | ------------------------ | ------ |
| `@opencode-ai/plugin`    | 1.18.3  | 2026-07-16T15:33:16.722Z | https://www.npmjs.com/package/@opencode-ai/plugin/v/1.18.3 |
| `@opencode-ai/sdk`       | 1.18.3  | 2026-07-16T15:33:09.660Z | https://www.npmjs.com/package/@opencode-ai/sdk/v/1.18.3 |
| `zod`                    | 4.1.8   | (transitive via plugin)  | https://www.npmjs.com/package/zod/v/4.1.8 |

Both OpenCode packages are published in lockstep. Recent stable versions
(verified via `npm view @opencode-ai/sdk versions --json`): `1.17.11`
through `1.18.3`. The plugin targets the `1.18.x` line; earlier versions
likely lack required hooks or types but are not blocked at install time.

## Plugin Export Shape

A server plugin is a default-or-named async function that receives
`PluginInput` and returns `Hooks`. Verified against
`node_modules/@opencode-ai/plugin/dist/index.d.ts` lines 1-124 and
against https://opencode.ai/docs/plugins/#basic-structure.

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const CodexMeterPlugin: Plugin = async (ctx) => {
  // ctx: { client, project, directory, worktree, serverUrl, $, experimental_workspace }
  return {
    event: async ({ event }) => { /* dispatch on event.type */ },
    tool: { codex_usage: tool({ description, args, execute }) },
  }
}
```

Permalink: https://github.com/anomalyco/opencode/blob/v1.18.3/packages/plugin/src/index.ts
(captured type fixture: `test/fixtures/plugin-index.d.ts.snapshot` is not
generated verbatim; we rely on the installed `dist/index.d.ts`).

## Event Hook Contract

The single `event` hook receives `{ event: Event }` where `Event` is the
v1 union exported by `@opencode-ai/sdk`. Captured verbatim from
`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`:

```ts
export type Event =
  | EventServerInstanceDisposed | EventInstallationUpdated
  | EventInstallationUpdateAvailable | EventLspClientDiagnostics
  | EventLspUpdated | EventMessageUpdated | EventMessageRemoved
  | EventMessagePartUpdated | EventMessagePartRemoved
  | EventPermissionUpdated | EventPermissionReplied
  | EventSessionStatus | EventSessionIdle | EventSessionCompacted
  | EventFileEdited | EventTodoUpdated | EventCommandExecuted
  | EventSessionCreated | EventSessionUpdated | EventSessionDeleted
  | EventSessionDiff | EventSessionError | EventFileWatcherUpdated
  | EventVcsBranchUpdated | EventTuiPromptAppend | EventTuiCommandExecute
  | EventTuiToastShow | EventPtyCreated | EventPtyUpdated | EventPtyExited
  | EventPtyDeleted | EventServerConnected
```

### Event payload shapes used by this plugin

Captured from `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`:

```ts
// lines 129-134
export type EventMessageUpdated = {
  type: "message.updated";
  properties: { info: Message };   // Message = UserMessage | AssistantMessage
};

// lines 135-141
export type EventMessageRemoved = {
  type: "message.removed";
  properties: { sessionID: string; messageID: string };
};

// lines 413-418
export type EventSessionIdle = {
  type: "session.idle";
  properties: { sessionID: string };
};

// lines 419-424
export type EventSessionCompacted = {
  type: "session.compacted";
  properties: { sessionID: string };
};

// lines 505-510
export type EventSessionDeleted = {
  type: "session.deleted";
  properties: { info: Session };   // Session.id is the session identifier
};
```

Notes:
- There is no distinct `session.created` payload for plugins beyond
  `EventSessionCreated.properties.info: Session`; we do not need it.
- `session.idle` carries only `sessionID`. Authoritative message state
  must be fetched via `client.session.messages({ path: { id } })`.
- `message.updated.properties.info` is the full `Message` union; we
  filter for `info.role === "assistant"` before extracting tokens.
- `message.removed.properties` gives the IDs needed to drop a snapshot
  without a rescan.
- `session.deleted.properties.info.id` is the session id to purge.

Permalink: https://github.com/anomalyco/opencode/blob/v1.18.3/packages/sdk/js/src/gen/types.gen.ts
(types are regenerated from the server OpenAPI spec at
`packages/sdk/openapi.json`).

## Session / Message / Token Contract

Captured from `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`
lines 39-128:

```ts
export type AssistantMessage = {
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  error?: ProviderAuthError | UnknownError | MessageOutputLengthError
        | MessageAbortedError | ApiError;
  parentID: string;
  modelID: string;
  providerID: string;
  mode: string;
  path: { cwd: string; root: string };
  summary?: boolean;
  cost: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  finish?: string;
};

export type UserMessage = {
  id: string;
  sessionID: string;
  role: "user";
  time: { created: number };
  agent: string;
  model: { providerID: string; modelID: string };
  // ...
};

export type Message = UserMessage | AssistantMessage;
```

Key observations:
- Token totals are **message-level** (not part-level). The single
  `AssistantMessage.tokens` object already holds the final totals for
  that assistant turn. There is no streaming-delta type in the public v1
  SDK; parts carry text/tool/reasoning content but not independent token
  counters.
- `reasoning` and `cache.read`/`cache.write` are always present on
  `AssistantMessage.tokens` as numbers (never `undefined`), per the
  generated type. We still normalize defensively in code: any missing
  field is treated as `0`, never as `undefined`.
- The `modelID` and `providerID` are flat strings on the assistant
  message; user messages nest them under `model: { providerID,
  modelID }`.

## session.messages() SDK Call

Verified against
`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` lines 2209-2243:

```ts
export type SessionMessagesData = {
  body?: never;
  path: { id: string };          // Session ID
  query?: { directory?: string; limit?: number };
  url: "/session/{id}/message";
};

export type SessionMessagesResponses = {
  200: Array<{ info: Message; parts: Array<Part> }>;
};
```

Plugin usage:

```ts
const result = await client.session.messages({
  path: { id: sessionID },
  query: { directory },          // optional, current project dir
})
// result.data is Array<{ info: Message; parts: Array<Part> }>
// filter info.role === "assistant" before aggregating tokens
```

`responseStyle: "fields"` (the SDK default) means `result.data` holds
the parsed body; errors are returned as `{ error }` rather than thrown
when `throwOnError: false` (also the default).

## TUI Toast API

Verified against
`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` lines 3264-3285:

```ts
export type TuiShowToastData = {
  body?: {
    title?: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    duration?: number;            // milliseconds
  };
  query?: { directory?: string };
  url: "/tui/show-toast";
};

export type TuiShowToastResponses = { 200: boolean };
```

Plugin usage:

```ts
await client.tui.showToast({
  body: {
    message: "5h 37% · week 62% | gpt-5.5: 184k in / 8.5k out",
    variant: "info",              // or "warning" when threshold met
    duration: 8000,
  },
})
```

`client.tui.showToast` is available on the `client` passed to a server
plugin (it is part of the generated `OpencodeClient` class, verified in
`node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts` line 364). The
return value resolves to `{ data: boolean | undefined, error?: ... }`.
Failures must be caught and logged but never thrown to OpenCode.

## Tool Registration

Verified against
`node_modules/@opencode-ai/plugin/dist/tool.d.ts`:

```ts
export type ToolContext = {
  sessionID: string;              // current session id
  messageID: string;
  agent: string;
  directory: string;
  worktree: string;
  abort: AbortSignal;
  metadata(input: { title?: string; metadata?: { [key: string]: any } }): void;
  ask(input: AskInput): Promise<void>;
};

export type ToolResult =
  | string
  | { title?: string; output: string; metadata?: { [key: string]: any };
      attachments?: ToolAttachment[] };

export declare function tool<Args extends z.ZodRawShape>(input: {
  description: string;
  args: Args;
  execute(args: z.infer<z.ZodObject<Args>>, context: ToolContext): Promise<ToolResult>;
}): { description: string; args: Args; execute: ... };

export declare namespace tool {
  var schema: typeof z;           // tool.schema === zod
}
```

Plugin usage:

```ts
return {
  tool: {
    codex_usage: tool({
      description: "Report Codex subscription quota and per-model session token usage.",
      args: {
        sessionID: tool.schema.string().optional().describe(
          "Session to report. Defaults to the current session."),
      },
      async execute(args, ctx) {
        const id = args.sessionID ?? ctx.sessionID
        const report = await buildReport(id)
        return { title: "Codex usage", output: report }
      },
    }),
  },
}
```

`ctx.sessionID` is the authoritative source for the current session and
is always a string. The optional `sessionID` argument exists only as a
convenience / for CLI parity; we do not need to require it for supported
OpenCode versions.

## Auth Contract

### Auth file location

The OpenCode CLI stores OAuth credentials in `~/.local/share/opencode/auth.json`
(see https://opencode.ai/docs/cli/#login). On macOS this resolves to
`$HOME/.local/share/opencode/auth.json`; OpenCode does not appear to
honor `XDG_DATA_HOME` (the docs are silent on XDG), so we attempt both
paths in this order:

1. `OPENCODE_AUTH_CONTENT` (unverified, see risk note below)
2. `CODEX_METER_AUTH_PATH` (plugin-specific override)
3. `$XDG_DATA_HOME/opencode/auth.json`
4. `$HOME/.local/share/opencode/auth.json`

### auth.json shape

OpenCode's own source (`packages/opencode/src/provider/auth.ts` on the
`dev` branch, captured 2026-07-17) writes credentials via
`auth.set(providerID, auth)` where `auth` is one of:

```ts
// From @opencode-ai/sdk/dist/gen/types.gen.d.ts lines 1458-1477
export type OAuth = {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;             // epoch milliseconds
  enterpriseUrl?: string;
  // accountId?: string       // NOT in the v1 SDK type, but see below
};

export type ApiAuth = {
  type: "api";
  key: string;
  metadata?: { [key: string]: string };
};

export type Auth = OAuth | ApiAuth | WellKnownAuth;
```

The on-disk file is a JSON object keyed by provider id, e.g.:

```json
{
  "openai": {
    "type": "oauth",
    "access": "eyJ...",
    "refresh": "rt_...",
    "expires": 1755400000000,
    "accountId": "acct_abc123"
  },
  "anthropic": { "type": "api", "key": "sk-ant-..." }
}
```

### accountId

The published `OAuth` type in `@opencode-ai/sdk@1.18.3` **does not**
declare `accountId`, but:

1. The plugin SDK's `AuthOAuthResult` (from
   `@opencode-ai/plugin/dist/index.d.ts` lines 126-163) **does** include
   `accountId?: string` on the OAuth success payload.
2. The server `provider/auth.ts` callback handler spreads `...extra` into
   `auth.set`, so `accountId` is persisted into `auth.json` even though
   the SDK type omits it.
3. The OpenAI/ChatGPT OAuth provider writes `accountId` there (per PR
   #9545 `packages/opencode/src/usage/providers/openai.ts`, which uses
   `auth.accountId` as the `ChatGPT-Account-Id` header).

Therefore the reader must treat `accountId` as an **optional string
field that may be present on entries of `type: "oauth"`** even though
the SDK type does not advertise it. We access it defensively via a
runtime cast, never via direct typed access.

### OPENCODE_AUTH_CONTENT

Not listed in the CLI environment-variables table
(https://opencode.ai/docs/cli/#environment-variables). The sibling
`OPENCODE_CONFIG_CONTENT` exists, but `OPENCODE_AUTH_CONTENT` is not
documented and not found in the `@opencode-ai/sdk@1.18.3` published
types. **We treat `OPENCODE_AUTH_CONTENT` as unsupported in v1**: if it
is ever set, we try to parse it as JSON and silently fall back to the
file path on failure, but we do not advertise it in README or rely on it
for correctness.

### Credential resolution rules

- We read **only** the OpenAI entry (provider key `"openai"`). Other
  providers are ignored.
- We extract `access`, `expires`, and (defensively) `accountId`.
- We **never** read, store, log, or return `refresh`.
- We **never** write to `auth.json`, call `auth.set`, or perform any
  OAuth refresh request.
- If the entry is missing, not OAuth, expired, or malformed, we return
  a `Credentials` object with `status: "unauthenticated" | "expired" |
  "missing-account-id" | "malformed"` and the quota provider surfaces
  the appropriate `QuotaStatus`.

## Quota Provider Selection

### Official /usage endpoint

**Not available.** Issue #9281
(https://github.com/anomalyco/opencode/issues/9281) tracks the feature;
PR #9545 (https://github.com/anomalyco/opencode/pull/9545) implements it
but is **not merged** as of 2026-07-17 (`mergeable_state: unstable`,
last force-push 2026-07-16). No released version of OpenCode ships the
`/usage` endpoint or the generated `usageGet` SDK method.

When a future release does ship `/usage`, the plugin can prefer it and
fall back to wham. For v1 we do not implement the official provider.

### wham endpoint (selected)

URL: `GET https://chatgpt.com/backend-api/wham/usage`

Headers:
```
Authorization: Bearer <access-token>
ChatGPT-Account-Id: <account-id>   (only if accountId is present)
```

This endpoint is **unsupported** and **undocumented** by OpenAI. Its
existence and shape were confirmed by:

1. PR #9545's `packages/opencode/src/usage/providers/openai.ts`, which
   calls exactly this URL with the same headers.
2. PR #9545's test fixture
   `packages/opencode/test/server/usage.test.ts` which stubs
   `https://chatgpt.com/backend-api/wham/usage`.

The response shape is not formally documented. We use a runtime Zod
schema with additive tolerance (unknown fields are allowed) and identify
windows by duration:

```ts
function identifyWindow(seconds: number): UsageWindow["kind"] {
  if (Math.abs(seconds - 18_000) < 300) return "five-hour"
  if (Math.abs(seconds - 604_800) < 3_600) return "weekly"
  return "unknown"
}
```

These thresholds match PR #9545's implementation (`5*60` minutes and
`7*24*60` minutes). Unknown windows are preserved in detailed/JSON
output.

### Failure handling

| HTTP / condition       | Behavior                                                   |
| ---------------------- | ---------------------------------------------------------- |
| 200, valid body        | Return `QuotaSnapshot { status: "ok" }`, cache it          |
| 200, schema mismatch   | `status: "unavailable"`, warning code `SCHEMA_CHANGED`      |
| 400/404/5xx            | `status: "unavailable"`, code `UNAVAILABLE`; use stale cache if fresh enough |
| 401/403                | `status: "unauthenticated"`, code `AUTH_REQUIRED`; no stale cache |
| 429                    | `status: "stale"` if cached, else `unavailable`; code `RATE_LIMITED` |
| Timeout                | `status: "stale"` if cached, else `unavailable`; code `TIMEOUT` |
| Network error          | `status: "stale"` if cached, else `unavailable`; code `UNAVAILABLE` |
| Expired local token    | `status: "unauthenticated"`, code `AUTH_REQUIRED`; do not attempt refresh |

## Tool Context sessionID

`ToolContext.sessionID` is a required `string` in the
`@opencode-ai/plugin@1.18.3` `tool.d.ts`. The plugin's `codex_usage`
tool uses `ctx.sessionID` as the default session and exposes an
optional `sessionID` argument only for CLI parity / advanced use.

## Known Compatibility Risks

1. **`OPENCODE_AUTH_CONTENT`** is not documented and not present in the
   published SDK types. We probe it defensively but do not rely on it.
2. **`OAuth.accountId`** is present on disk and in `AuthOAuthResult`
   but absent from the v1 `OAuth` SDK type. We access it via a runtime
   cast with optional-string handling.
3. **`auth.json` location** does not mention `XDG_DATA_HOME` in the
   docs; we try both `$XDG_DATA_HOME/opencode/auth.json` and
   `$HOME/.local/share/opencode/auth.json` in that order.
4. **wham endpoint** is unsupported. It may change shape, move, or
   disappear without notice. The plugin must remain useful when it
   fails: token accounting is independent and continues.
5. **PR #9545 / Issue #9281** may merge and ship a stable `/usage`
   endpoint in a future release. At that point this plugin should prefer
   the official endpoint and fall back to wham; for v1 we only implement
   wham.
6. **Plugin `event` hook** receives the v1 `Event` union. The v2 union
   (used by `@opencode-ai/sdk/v2` and the TUI event bus) is larger and
   includes `session.next.*` events. We stay on the v1 SDK and v1 plugin
   API; mixing v2 types could break at runtime under a Bun-less host.
7. **`BunShell` (`$`)** is part of `PluginInput` but we do not use it;
   this keeps the plugin compatible with any runtime that can load the
   SDK client.
8. **Token totals are message-level.** Some future OpenCode version may
   switch to part-level accounting (e.g. via `StepFinishPart.tokens` in
   the v2 SDK). The v1 `AssistantMessage.tokens` is the only stable
   source for v1; we do not read parts.
9. **`session.deleted.properties.info.id`** is the canonical session
   identifier for cleanup. We do not assume any other field on
   `Session` is safe to read; we only touch `.id`.
