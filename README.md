# opencode-codex-meter

An [OpenCode](https://opencode.ai) plugin that reports **Codex subscription
quota** and **per-session token usage** — without spending a model turn.

## What it does

- **Sidebar panel** — a persistent panel in OpenCode's sidebar showing live
  quota bars (5h and weekly windows) and per-model token usage, updating in
  real time as tokens stream.

  Available manual usage limit resets appear below the quota bars, with
  the limits they restore and expiration dates in your local time zone.
  Reset information refreshes with quota data (every 90 seconds by default).

  ```text
  ┌─ Codex Meter ───────────────────────────────────────────┐
  │ 5h quota      [████████░░░░░░░░░░░░] 37%  resets 2h 14m │
  │ Weekly quota  [████████████░░░░░░░░] 62%  resets 5d 5h  │
  │                                                         │
  │ Usage limit resets                                      │
  │   2 available                                           │
  │                                                         │
  │   Full reset (Weekly + 5 hr)                            │
  │   Expires Oct 4, 8:37 AM                                │
  │                                                         │
  │   Full reset (Weekly + 5 hr)                            │
  │   Expires Oct 5, 7:21 AM                                │
  │                                                         │
  │ openai/gpt-5.5  (5 msgs)                                │
  │   Input        184,230                                  │
  │   Output         8,491                                  │
  │   Reasoning     21,048                                  │
  │   Cache read   421,120                                  │
  │   Cache write       0                                   │
  │   Total        634,889                                  │
  └─────────────────────────────────────────────────────────┘
  ```

- **`codex_usage` tool** — ask the agent to call it for a detailed report
  covering both quota and per-session token totals.

- **`codex-meter` CLI** — print a report from your shell:

  ```bash
  codex-meter --session <session-id>        # human-readable
  codex-meter --session <session-id> --json # JSON output
  codex-meter --quota-only                  # quota only, no session needed
  ```

Quota data comes from the ChatGPT backend and may be unavailable (the plugin
keeps working with token totals only). Token totals are always available.
If reset details are unavailable, the plugin still shows the known count.
An unavailable count is shown as unavailable, never as zero. Cached reset
data is labeled stale after a failed quota refresh. The sidebar only displays
resets; use the Codex usage page to redeem one.

## Install

```bash
opencode plugin opencode-codex-meter --global
```

That's it. This one command installs the package and configures both the
server tool and the TUI sidebar — no manual config editing required.

> **Manual install (alternative):** if you prefer to edit config files by
> hand, the plugin must be registered in **both** config files because
> OpenCode keeps server and TUI plugins separate:
>
> ```jsonc
> // ~/.config/opencode/opencode.json
> { "plugin": ["opencode-codex-meter"] }
>
> // ~/.config/opencode/tui.json
> { "plugin": ["opencode-codex-meter"] }
> ```
>
> Then run `npm install opencode-codex-meter` in `~/.config/opencode/`.
> Using `opencode plugin ... --global` is strongly recommended instead.

## Run

1. Start OpenCode in a project:

   ```bash
   opencode
   ```

2. Authenticate with your ChatGPT/Codex account (only needed once for quota
   data; token totals work without auth):

   ```bash
   opencode auth login -p openai
   ```

3. Start a session and send a message. The sidebar panel appears
   automatically and updates as the session progresses.

To get a report on demand, ask the agent: *"Call the codex_usage tool."*
Or from a shell:

```bash
codex-meter --session <session-id>
```

## Configuration

All settings are optional environment variables:

| Variable                       | Default | Purpose                       |
| ------------------------------ | ------- | ----------------------------- |
| `CODEX_METER_ENABLED`          | `true`  | Disable all plugin behavior.  |
| `CODEX_METER_AUTH_PATH`        | unset   | Explicit `auth.json` path.    |
| `CODEX_METER_QUOTA_TTL_MS`     | `90000` | Quota cache lifetime (ms).    |
| `CODEX_METER_QUOTA_TIMEOUT_MS` | `5000`  | Network request timeout (ms). |
| `CODEX_METER_WARNING_PERCENT`  | `80`    | Warning threshold.            |
| `CODEX_METER_DEBUG`            | `false` | Sanitized debug logging.      |

## Troubleshooting

- **No quota data** — run `opencode auth login -p openai`. The plugin never
  refreshes tokens; restart OpenCode after re-authenticating. The wham
  endpoint is undocumented and may occasionally fail; token totals keep
  working.
- **Sidebar not appearing** — ensure the plugin is installed via
  `opencode plugin opencode-codex-meter --global` (writes both `opencode.json`
  and `tui.json`). Restart OpenCode. Open a session and send at least one
  message.
- **CLI cannot connect** — ensure the OpenCode server is running
  (`opencode serve`) or pass `--server-url http://127.0.0.1:4096`.

## Privacy

- Reads only the OpenAI OAuth `access` token, `expires`, and `accountId` from
  `~/.local/share/opencode/auth.json`.
- Never reads, stores, or logs the `refresh` token.
- Never writes to `auth.json` or refreshes OAuth credentials.
- Makes read-only requests to `https://chatgpt.com/backend-api/wham/usage`
  and, when resets are available, `/backend-api/wham/rate-limit-reset-credits`
  on the same host. Never redeems a reset.

See [SECURITY.md](./SECURITY.md) for the full security policy.

## License

MIT
