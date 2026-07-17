# Architecture

## Overview

```text
OpenCode events ──────────────┐
                               ├── SessionCollector ── SessionStore ── per-model totals
OpenCode session.messages() ──┘

OpenCode auth.json ───────────┐
                               ├── AuthReader ── WhamProvider ── CachedProvider ── QuotaSnapshot
Official usage API (future) ──┘

Session totals + quota snapshot ── ReportBuilder
                                        ├── formatCompact  (server toast)
                                        ├── formatDetailed (tool/CLI)
                                        └── formatJson     (CLI --json)

─── Dual entry points ───

  . (server)         session.event/tool hooks ── ReportBuilder ── tool output / toast
  ./tui (TUI)        @opentui/solid sidebar slot ── compute() ── signals ── render
```

## Module boundaries

All OpenCode SDK types are isolated at adapter boundaries. Core modules
(aggregation, quota normalization, reporting) are testable without
starting OpenCode.

### src/session/

- **types.ts** — stable internal data contracts (`TokenUsage`,
  `AssistantMessageSnapshot`, `ModelUsage`, `SessionUsage`).
- **aggregate.ts** — pure `SessionStore` with idempotent upsert/remove/
  replaceSession/getSessionUsage/deleteSession. No SDK dependency.
- **opencode-adapter.ts** — narrow SDK adapter. Converts SDK `Message`
  to `AssistantMessageSnapshot`, extracts event payloads. The only
  module that knows SDK-specific field names.
- **collector.ts** — `SessionCollector` that hydrates sessions via
  `session.messages()`, dispatches on events, uses generation counter
  for stale hydration prevention, and re-applies pending operations
  after rescan.

### src/quota/

- **types.ts** — `QuotaSnapshot`, `UsageWindow`, `QuotaProvider`
  interface, `HttpTransport`, `Clock`, `WarningCode`,
  `identifyWindow()` (duration-based window classification).
- **auth-reader.ts** — `AuthReader` with injectable fs/env/home/clock.
  Reads only the OpenAI OAuth entry's access/expires/accountId. Never
  returns refresh token. Never writes. Never refreshes.
- **schemas.ts** — tolerant Zod validation for the wham response.
  Accepts additive fields, alternative field names, and top-level
  arrays. Identifies windows by duration.
- **wham-provider.ts** — `WhamProvider` implementing `QuotaProvider`.
  Uses injectable `HttpTransport`, timeout with AbortController,
  handles 401/403/429/5xx/timeout/malformed/schema-drift.
- **cached-provider.ts** — `CachedProvider` wrapping a `QuotaProvider`
  with TTL cache, in-flight deduplication, stale-if-error fallback,
  and shorter negative TTL for unauthenticated results.

### src/report/

- **build.ts** — `buildReport()` combining session usage + quota into
  a `Report` model. Models sorted by total tracked tokens (desc) then
  model key (asc). `isWarning` flag based on threshold.
- **compact.ts** — `formatCompact()` for toast output.
  `compactNumber()` for k/M formatting. `toastVariant()` for variant.
- **detailed.ts** — `formatDetailed()` for terminal/tool output.
  `formatResetDuration()` for human-readable reset times.
- **json.ts** — `toJsonReport()` and `formatJson()` with
  `schemaVersion: 1`.

### src/config.ts

Environment variable parsing with safe defaults.

### src/redact.ts

Centralized redaction helper (`redact`, `redactDeep`, `sanitizeError`).

### src/index.ts

Plugin assembly: wires all modules into the OpenCode plugin hooks
(event handler, codex_usage tool).

### src/cli/main.ts

Companion CLI: reuses all modules, connects to OpenCode server via SDK,
supports --session, --quota-only, --json, --help, --version.

### src/tui/

The TUI entry point (`./tui`) renders a persistent sidebar panel into
OpenCode's `sidebar_content` slot via `@opentui/solid`. Pure modules are
fully unit-tested; Solid components are covered by smoke tests.

- **compute.ts** — pure `computeReport()` mapping messages + quota to
  the render-ready report shape. No SDK or Solid dependency. Fully
  unit-tested.
- **theme.ts** — pure `resolveTheme()` mapping variant + palette to
  color tokens. No Solid dependency. Fully unit-tested.
- **signals.ts** — Solid `createSignal` reactive state bridge. Holds
  the current report, recompute trigger, and quota fetcher. Updates
  trigger re-render of slot content.
- **quota-bar.tsx** — Solid component rendering a labeled progress bar
  for a quota window (5h or weekly).
- **token-table.tsx** — Solid component rendering per-model token rows
  (input, output, reasoning, cache) with a total row.
- **sidebar.tsx** — `SidebarContent` component composing quota bars +
  token table into the full panel layout.
- **index.tsx** — TUI entry point. Wires OpenCode event hooks to
  signals, fetches quota, and renders `SidebarContent` into the
  `sidebar_content` slot.

## Data flow

1. **Event arrives** → `SessionCollector.handleEvent()` → upsert/remove/
   hydrate on `SessionStore`.
2. **session.idle** → collector rescans via `session.messages()` →
   `SessionStore.replaceSession()` → pending ops re-applied.
3. **Quota fetch** → `AuthReader.readCredentials()` → `WhamProvider.fetch()`
   → `CachedProvider` checks cache → HTTP request if needed →
   `parseWhamResponse()` → `QuotaSnapshot`.
4. **Report** → `buildReport(sessionID, usage, quota)` →
   `formatCompact()` for toast, `formatDetailed()` for tool,
   `formatJson()` for CLI --json.

### TUI data flow (sidebar entry point)

1. **Event arrives** → TUI event hook → `computeReport(messages, quota)`
   → pure report shape.
2. **Recompute** → `signals.setReport()` updates the reactive
   `createSignal` → Solid schedules re-render.
3. **Quota fetch** → `signals` quota fetcher → `CachedProvider` (shared
   with server entry) → quota snapshot → recompute.
4. **Slot render** → `SidebarContent` reads signals → renders
   `QuotaBar` + `TokenTable` into the `sidebar_content` slot.

## Key invariants

1. **Replace by message ID** — streaming updates replace, never increment.
2. **Rescan on idle** — authoritative message list repairs missed events.
3. **Keep measures separate** — input/output/reasoning/cache/quota are
   distinct values.
4. **Never calculate quota from tokens** — they are independent.
5. **Never refresh OAuth** — OpenCode owns the credential lifecycle.
6. **Map windows by duration** — not by response position.
7. **No secret leakage** — redaction applies to all output paths.
