# Security Policy

## Sensitive Data Handling

`opencode-codex-meter` handles OAuth credentials and usage data. This
document describes what sensitive data the plugin touches and how it
protects it.

### What the plugin reads

- **`auth.json`** — the OpenCode credential file at
  `~/.local/share/opencode/auth.json` (or `$XDG_DATA_HOME/opencode/auth.json`).
  The plugin reads **only** the OpenAI OAuth entry's `access`,
  `expires`, and `accountId` fields. It **never** reads, stores, logs,
  or returns the `refresh` token.

- **Session messages** — the plugin reads assistant message token counts
  (`input`, `output`, `reasoning`, `cache.read`, `cache.write`) via the
  OpenCode SDK's `session.messages()` API. It does not read message
  text, tool inputs/outputs, or file contents.

- **Quota response** — the plugin fetches usage data from the
  unsupported `https://chatgpt.com/backend-api/wham/usage` endpoint.
  The response contains usage percentages and reset times, not
  credentials.

- **Manual reset details** — when usage reports available resets, the plugin
  reads `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`.
  It retains only the available count and display details (reset type,
  sanitized title, expiration) for available, unexpired, plan-supported resets.
  Reset IDs, profile fields, and redemption history are discarded.

### What the plugin never does

- **Never writes to `auth.json`** — the plugin has no auth-write
  capability. The `AuthReader` only reads.
- **Never refreshes OAuth tokens** — the plugin does not send refresh
  requests. OpenCode owns the credential lifecycle.
- **Never logs access tokens, refresh tokens, JWTs, account IDs, or
  Authorization headers** — all log and error paths are sanitized by
  the centralized `redact.ts` module.
- **Never sends telemetry** — no analytics, no usage reporting, no
  phone-home.
- **Never makes unexpected network requests** — the only network
  destinations are `https://chatgpt.com/backend-api/wham/usage` and
  `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`, and only
  when credentials are available. Both use GET; the plugin never redeems
  or purchases resets.
- **Never executes install-time code** — the package has no
  `postinstall`, `preinstall`, or other lifecycle scripts.

### Centralized redaction

The `src/redact.ts` module provides:

- `redact(input: string): string` — replaces JWT-like strings, Bearer
  tokens, refresh tokens (rt_...), account IDs (acct_...), API keys
  (sk-...), and generic long token-like strings.
- `redactDeep(value: unknown): unknown` — recursively redacts objects
  and arrays, and skips known secret field names (`access`, `refresh`,
  `authorization`, `accountId`, `key`, `token`).
- `sanitizeError(err: unknown)` — extracts and redacts error messages
  and codes.

### Unsupported endpoint risk

The ChatGPT backend usage and reset-details endpoints are
**undocumented and unsupported** by OpenAI. They may change shape, move,
or disappear without notice. The plugin:

- Validates the response at runtime with a tolerant Zod schema.
- Identifies windows by duration (not response position).
- Preserves unknown windows rather than discarding them.
- Treats any failure (401/403/429/5xx/timeout/malformed) as
  non-fatal — session token reporting continues independently.
- Keeps quota and the known reset count if the optional reset-details
  request fails, times out, or changes schema.
- Does not cache `unauthenticated` for the full TTL (uses a shorter
  30-second negative cache).

### Automated secret-leak prevention

The test suite includes an automated secret-leak scan that checks:

- All test output and snapshots for known secret patterns.
- All built files in `dist/` for embedded credentials.
- The packed tarball contents for leaked secrets.

The scan uses synthetic secret fixtures (`ey_fake_access`,
`rt_fake_refresh`, `acct_fake`) and verifies they never appear in
output, logs, or packaged artifacts.

## Graceful Degradation

| Failure                          | Expected behavior                                                         |
| -------------------------------- | ------------------------------------------------------------------------- |
| No OpenAI auth                   | Full session tokens; quota marked `unauthenticated`.                      |
| Expired auth                     | Full session tokens; actionable auth warning; no refresh attempt.         |
| Quota endpoint changed           | Full session tokens; quota `unavailable` or `stale` if cached.            |
| OpenCode message rescan fails    | No crash; sanitized warning; retain last internally consistent snapshot. |
| Toast API unavailable            | Tool and CLI continue; log one sanitized warning.                         |
| Multiple session events          | Sessions remain isolated and totals idempotent.                           |
| Network timeout                  | Quota `unavailable` or `stale`; token reporting continues.                |
| Malformed quota response         | Quota `unavailable` with `SCHEMA_CHANGED` code; token reporting continues. |
| Plugin disabled (CODEX_METER_ENABLED=false) | No filesystem or network work performed.                       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it privately
by opening a GitHub security advisory. Do not file a public issue.
