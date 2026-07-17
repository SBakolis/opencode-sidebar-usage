# Codex Meter Sidebar Integration — Design

## Problem

The `opencode-codex-meter` plugin currently reports usage via three transient channels: a
toast (8s), a `codex_usage` tool, and a CLI. The user wants persistent, live usage
visible in OpenCode's sidebar.

The OpenCode plugin SDK (`@opencode-ai/plugin@1.18.3`) exposes a TUI plugin system via
the `./tui` export subpath. TUI plugins run in the TUI process and can render JSX
(via `@opentui/solid`) into named sidebar slots. This design adds a second entry point
to the existing package.

## Decisions

| Decision | Choice |
|----------|--------|
| Sidebar slot | `sidebar_content` |
| Update cadence | Live (every `message.part.updated` / `session.idle` event) |
| Toast | Removed (sidebar replaces it) |
| Approach | Shared modules + Solid signals (Approach A) |

## Architecture

### Dual entry points

One npm package, two processes:

```
opencode-codex-meter
├── src/index.ts          → dist/index.js       (server plugin)
├── src/tui/index.tsx     → dist/tui/index.js   (TUI plugin)
└── shared modules (aggregate, auth-reader, wham-provider, cached-provider, report)
```

**Server process** (existing, modified):
- Keeps `codex_usage` tool (CLI and agent can still call it)
- Keeps event tracking via `SessionCollector` (feeds the tool)
- Removes the toast code and `CODEX_METER_SHOW_TOAST` config

**TUI process** (new):
- Independent `SessionStore` built from `api.state.session.messages(sessionID)`
- Live updates via `api.event.on(...)` for message and session events
- Quota fetched via shared `CachedProvider` + `WhamProvider` + `AuthReader`
- Renders JSX into `sidebar_content` slot using `@opentui/solid`
- Solid `createSignal` drives reactive re-renders

The two processes do not share memory. Each builds its own `SessionStore`. The TUI has
all messages available synchronously via `api.state.session.messages()`, so it does not
need the server's hydration/rescan logic.

### Module reuse

The TUI plugin imports these existing, tested modules directly:

| Module | Purpose | Tests |
|--------|---------|-------|
| `aggregate.ts` | `SessionStore` (upsert/replace/remove) | 100% coverage |
| `auth-reader.ts` | Credential discovery from `auth.json` | 25 tests |
| `wham-provider.ts` | HTTP fetch from wham endpoint | covered |
| `cached-provider.ts` | TTL cache, dedup, stale-if-error | covered |
| `report/build.ts` | `buildReport()` — sorted per-model breakdown | covered |
| `report/compact.ts` | `compactNumber()` for k/M formatting | covered |

No logic is duplicated. The TUI adds only: JSX components, Solid signals, and event
wiring.

## Sidebar UI Layout

```
┌─────────────────────────────┐
│ Codex Meter                 │
├─────────────────────────────┤
│ Quota                       │
│ 5h    ████████░░░░  63%     │
│ week  ██████████░░  87%     │
│        resets 4h 23m        │
├─────────────────────────────┤
│ Tokens (this session)       │
│ gpt-5.5     184k in         │
│              8.5k out        │
│             1.2k cache       │
│ o4-mini      12k in          │
│               3k out         │
├─────────────────────────────┤
│ Total         196k in        │
│               11.5k out      │
└─────────────────────────────┘
```

### Design details

- **Quota bars**: `box` elements with width-percentage styling. Color: green under 80%,
  warning yellow 80-95%, red over 95% (driven by `CODEX_METER_WARNING_PERCENT`).
- **Token table**: One row per model (sorted by total tokens desc via `buildReport`).
  Each model shows `input`, `output`, and `cache` (read+write combined). Model key in
  muted text color.
- **Total row**: Sum across all models, slightly emphasized.
- **Theme**: Uses `api.theme.current` for all colors (`text`, `textMuted`, `success`,
  `warning`, `error`, `border`).
- **Compactness**: 10-15 lines max. Uses `box` with border and padding. No scrolling.

## Data Flow & Reactive Updates

```
TUI plugin init
  │
  ├── api.event.on("session.updated")   → set active session ID
  ├── api.event.on("message.part.updated") → recompute tokens
  ├── api.event.on("message.updated")   → recompute tokens
  ├── api.event.on("session.idle")      → recompute tokens + refresh quota
  ├── api.event.on("session.deleted")   → clear active session
  └── setInterval(quotaTtlMs)           → refresh quota (stale fallback)
```

### Token computation (on every message event)

1. Read `api.state.session.messages(sessionID)` — returns full `Message[]` synchronously
2. Filter assistant messages, extract `.tokens` from each
3. Run through shared `aggregate.ts` (`SessionStore.replaceSession()`)
4. Call `buildReport()` for sorted per-model breakdown
5. Set `reportSignal` — Solid triggers re-render

Cheap operation: message list is in memory, aggregation is pure and fast. No network
calls on the token path.

### Quota computation (on idle + interval)

1. `AuthReader.readCredentials()` — reads `auth.json` from disk
2. `CachedProvider.fetch()` — returns cached snapshot or hits `WhamProvider`
3. Set `quotaSignal` — Solid triggers re-render

Quota interval: `CODEX_METER_QUOTA_TTL_MS` (default 90s). On error, `CachedProvider`
returns stale data or `null`. The interval ensures the bar updates during long sessions
without idle events.

### Active session tracking

`api.event.on("session.updated")` updates the current session ID. On the home screen
(no session active), sidebar shows "No active session".

### Cleanup

`api.lifecycle.onDispose()` clears the interval and event subscriptions.

## Package Structure & Build

### New files

```
src/tui/
├── index.tsx          # TUI plugin entry (TuiPluginModule)
├── sidebar.tsx        # SidebarContent component (JSX)
├── quota-bar.tsx      # QuotaBar component (JSX)
├── token-table.tsx    # TokenTable component (JSX)
├── signals.ts         # createSignal state (report, quota, sessionID)
├── compute.ts         # Messages → SessionStore → buildReport (pure)
└── theme.ts           # Theme color resolution helper
```

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add `exports["./tui"]`, add `@opentui/solid` + `solid-js` peerDeps, add `@opentui/solid` devDep |
| `tsup.config.ts` | Keep for server/CLI; add separate `build:tui` using Bun + `@opentui/solid/bun-plugin` |
| `tsconfig.json` | Add JSX config (`"jsx": "preserve"`, `"jsxImportSource": "@opentui/solid"`) |
| `src/index.ts` | Remove toast code, remove `CODEX_METER_SHOW_TOAST` handling |
| `src/config.ts` | Remove `SHOW_TOAST` field |
| `README.md` | Update to reflect sidebar display, remove toast docs |

### Build output

```
dist/
├── index.js           # server plugin (existing)
├── index.d.ts
├── tui/
│   ├── index.js       # TUI plugin (new)
│   └── index.d.ts
├── cli/
│   ├── main.js        # CLI (existing)
│   └── main.d.ts
```

### package.json exports

```json
{
  ".":     { "import": "./dist/index.js" },
  "./tui": { "import": "./dist/tui/index.js" },
  "./cli": { "import": "./dist/cli/main.js" }
}
```

OpenCode's TUI plugin loader checks for `exports["./tui"]`. If found, it loads that
entry in the TUI process. The server entry (`.`) loads in the server process.

### Build tooling

`tsup` (esbuild) does not handle Solid's JSX transform. The `@opentui/solid` package
ships a Bun plugin for JSX compilation. Since OpenCode loads plugins via Bun's module
system:

- `npm run build` — tsup for server + CLI entries (existing, unchanged)
- `npm run build:tui` — `bun build` with `@opentui/solid/bun-plugin` for TUI entry
- `npm run build:all` — runs both in sequence

## Error Handling & Edge Cases

### Quota failures (graceful)

| Condition | Sidebar display |
|-----------|----------------|
| No `auth.json` found | "Quota: unauthenticated" (muted, no bar) |
| Network error | Stale snapshot if available, else "Quota: unavailable" |
| Schema drift | Parsed as `null`, "Quota: unavailable" |
| Timeout | Same as network error |

None of these crash the TUI or block token display.

### Token edge cases

| Condition | Behavior |
|-----------|----------|
| Messages with no `.tokens` | Skipped (existing `aggregate.ts` behavior) |
| Zero assistant messages | "No usage yet" instead of empty table |
| Multiple models in session | Each gets its own row |
| Session deleted | Active session cleared, "No active session" |

### TUI lifecycle

| Condition | Behavior |
|-----------|----------|
| Plugin fails to load | OpenCode logs error, sidebar slot empty, server plugin + CLI still work |
| Signal update during unmount | Guarded by `api.lifecycle.signal` AbortSignal |
| Component render error | Solid error boundary catches, renders "Meter error" |

### Redaction

- Debug logging via `api.client.app.log()` uses existing `redact()` helper
- No tokens, model names, or quota values are logged
- Sidebar display shows raw numbers (safe — in user's own TUI)

## What Does Not Change

- CLI works exactly as before (independent of TUI)
- `codex_usage` tool works exactly as before
- Server plugin still tracks events for the tool
- All existing 196 tests remain valid
- Coverage thresholds unchanged

## New Dependencies

| Package | Type | Version | Purpose |
|---------|------|---------|---------|
| `@opentui/solid` | peer + dev | `>=0.4.3` | JSX reconciler for OpenTUI |
| `solid-js` | peer + dev | `>=1.9.0` | Reactive primitives (createSignal) |

These are already installed by OpenCode itself (peer dependencies of
`@opencode-ai/plugin`). No new runtime burden on the user.

## Scope Boundaries

### In scope

- New `./tui` entry point with sidebar rendering
- Removal of toast code and config
- Bun-based build for TUI entry
- README updates
- New tests for TUI compute layer (pure functions)
- Smoke test for built TUI output

### Out of scope

- Full-page route with detailed breakdown (Approach C, deferred)
- Quota history graphing
- Multi-session aggregation (parent/child sessions)
- Custom keybindings
- npm publication
