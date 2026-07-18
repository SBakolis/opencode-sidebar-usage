# opencode-codex-meter

An [OpenCode](https://opencode.ai) plugin that reports **Codex subscription
quota** and **per-session token usage** — without spending a model turn.

## Installation

```bash
opencode plugin opencode-codex-meter --global
```

This one command installs the package and configures both targets: the server
tool and the TUI sidebar. No local `file://` URLs or manual configuration are
required.

## What it reports

1. **Codex subscription quota** — 5-hour and weekly usage windows with
   reset information, credits, and plan type. Fetched from the ChatGPT
   backend (unsupported endpoint, gracefully degrades).

2. **Per-session token usage** — total tokens for the current OpenCode
   session, grouped by model. Input, output, reasoning, cache-read, and
   cache-write are shown separately.

### Quota vs. token totals

These are **independent measurements**:

- **Quota** is your Codex subscription consumption (5-hour and weekly
  windows). It depends on factors not represented by raw token counts.
- **Token totals** are the actual tokens used in your OpenCode session.
  They are always available, even when quota data is not.

Never infer quota consumption from token counts.

## Configuration

All configuration is via environment variables:

| Variable                        | Default  | Purpose                              |
| ------------------------------- | -------- | ------------------------------------ |
| `CODEX_METER_ENABLED`           | `true`   | Disable all plugin behavior.         |
| `CODEX_METER_AUTH_PATH`         | unset    | Explicit `auth.json` path.           |
| `CODEX_METER_QUOTA_TTL_MS`      | `90000`  | Quota cache lifetime (ms).           |
| `CODEX_METER_QUOTA_TIMEOUT_MS`  | `5000`   | Network request timeout (ms).        |
| `CODEX_METER_WARNING_PERCENT`   | `80`     | Warning threshold.                    |
| `CODEX_METER_DEBUG`             | `false`  | Sanitized debug logging only.        |

## Usage

### Sidebar

The plugin renders a persistent panel in OpenCode's sidebar. The panel
shows live quota bars (5h and weekly windows) and per-model token usage,
updating in real time as tokens stream. The sidebar appears when an
OpenCode session is active.

```text
┌─ Codex Meter ────────────────────────────────┐
│ 5h quota      [████████░░░░░░░░░░░░] 37%      │
│ Weekly quota  [████████████░░░░░░░░] 62%      │
│                                               │
│ openai/gpt-5.5  (5 msgs)                      │
│   Input        184,230                        │
│   Output         8,491                         │
│   Reasoning     21,048                        │
│   Cache read   421,120                        │
│   Cache write       0                         │
│   Total        634,889                        │
└───────────────────────────────────────────────┘
```

When quota is unavailable, the panel shows token usage without the
quota bars.

### Tool

Ask the agent to call the `codex_usage` tool for a detailed report:

```text
Codex subscription
  5h:       37% used · resets in 2h 14m
  Weekly:   62% used · resets in 4d 0h
  Credits:  14.50
  Plan:     plus

Current OpenCode session
  openai/gpt-5.5  (5 msgs)
    Input:       184,230
    Output:        8,491
    Reasoning:    21,048
    Cache read:  421,120
    Cache write:      0
```

Note: asking an agent to call the tool still consumes the surrounding
model turn. The tool itself does NOT make a model call.

### CLI

```bash
# Human-readable report for a session
codex-meter --session <session-id>

# JSON output
codex-meter --session <session-id> --json

# Quota only (no session needed)
codex-meter --quota-only

# Help and version
codex-meter --help
codex-meter --version
```

Sample JSON output:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-17T10:00:00.000Z",
  "session": {
    "sessionID": "abc123",
    "models": [
      {
        "providerID": "openai",
        "modelID": "gpt-5.5",
        "messageCount": 5,
        "input": 184230,
        "output": 8491,
        "reasoning": 21048,
        "cacheRead": 421120,
        "cacheWrite": 0
      }
    ]
  },
  "quota": {
    "status": "ok",
    "source": "chatgpt-wham",
    "planType": "plus",
    "fiveHour": { "kind": "five-hour", "usedPercent": 37.5, ... },
    "weekly": { "kind": "weekly", "usedPercent": 62.3, ... }
  },
  "isWarning": false
}
```

## Auth and Privacy

- The plugin reads **only** the OpenAI OAuth entry's `access` token,
  `expires`, and `accountId` from `~/.local/share/opencode/auth.json`.
- It **never** reads, stores, or logs the `refresh` token.
- It **never** writes to `auth.json` or refreshes OAuth credentials.
- It **never** sends telemetry or makes unexpected network requests.
- The only network destination is `https://chatgpt.com/backend-api/wham/usage`.

See [SECURITY.md](./SECURITY.md) for the full security policy.

## Unsupported Endpoint Warning

The `https://chatgpt.com/backend-api/wham/usage` endpoint is
**undocumented and unsupported** by OpenAI. It may change or disappear
without notice. The plugin:

- Validates the response at runtime.
- Identifies windows by duration, not response position.
- Treats any failure as non-fatal — token reporting continues.

## Supported OpenCode Versions

- `@opencode-ai/plugin` and `@opencode-ai/sdk` **1.18.x** (verified
  against 1.18.3, published 2026-07-16).
- Node.js ≥ 20 (or Bun).
- The plugin uses the v1 plugin API (`Hooks.event`, `Hooks.tool`).

### Compatibility details

The plugin aggregates the message-level `AssistantMessage.tokens` fields
(`input`, `output`, `reasoning`, and `cache.read`/`cache.write`) and uses
`ToolContext.sessionID` as the current-session source. It reads the OpenAI
OAuth entry from `auth.json` using `CODEX_METER_AUTH_PATH`,
`$XDG_DATA_HOME/opencode/auth.json`, or
`$HOME/.local/share/opencode/auth.json`; `OPENCODE_AUTH_CONTENT` is parsed
defensively when present but is not a supported contract.

The ChatGPT wham endpoint is undocumented and may change. Runtime schema
validation treats quota failures as non-fatal, so session token reporting
continues. The optional OAuth `accountId` is read defensively because it is
available on disk but not declared by the pinned v1 SDK OAuth type.

## Troubleshooting

### No quota data

- **Not authenticated**: Run `opencode auth login -p openai` to authenticate
  with your ChatGPT/Codex account.
- **Expired auth**: The plugin does not refresh tokens. Restart OpenCode
  after re-authenticating.
- **Missing account ID**: The `auth.json` entry may be from an older
  OpenCode version. Re-authenticate to get the `accountId` field.
- **Endpoint failure**: The wham endpoint may be unavailable. Token
  reporting continues without quota data.

### Sidebar not appearing

- Ensure the plugin is loaded (check `opencode` startup logs).
- The sidebar appears when an OpenCode session is active — start or
  open a session.
- Complete at least one assistant turn so token usage is populated.

### CLI cannot connect

- Ensure the OpenCode server is running: `opencode serve`
- Check the server URL: `codex-meter --session <id> --server-url http://127.0.0.1:4096`

### SDK incompatibility

- Verify you're using `@opencode-ai/plugin` and `@opencode-ai/sdk` 1.18.x.
- Confirm that the v1 plugin API provides `Hooks.event`, `Hooks.tool`,
  message-level token fields, and `ToolContext.sessionID` as described
  above.

## Known Limitations

- **Current session only** — child/subagent sessions are not aggregated
  into the parent.
- **No OAuth refresh** — the plugin never refreshes credentials. If auth
  expires, quota reporting stops until OpenCode re-authenticates.
- **wham endpoint is unsupported** — may break without notice. Token
  reporting is independent and continues.

## License

MIT (see package.json for details).
