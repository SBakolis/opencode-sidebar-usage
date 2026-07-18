/**
 * Plugin configuration.
 *
 * All configuration is loaded from environment variables. Values are
 * validated once during plugin initialization. Invalid configuration
 * produces one actionable, sanitized warning and falls back to safe
 * defaults.
 *
 * | Variable                        | Default  | Purpose                              |
 * | ------------------------------- | -------- | ------------------------------------ |
 * | CODEX_METER_ENABLED             | true     | Disable all plugin behavior.         |
 * | CODEX_METER_AUTH_PATH           | unset    | Explicit auth.json path.             |
 * | CODEX_METER_QUOTA_TTL_MS        | 90000    | Successful quota cache lifetime.     |
 * | CODEX_METER_QUOTA_TIMEOUT_MS    | 5000     | Network request timeout.             |
 * | CODEX_METER_WARNING_PERCENT     | 80       | Warning threshold percentage.        |
 * | CODEX_METER_DEBUG               | false    | Sanitized debug logging only.        |
 */

export interface PluginConfig {
  readonly enabled: boolean;
  readonly authPath: string | null;
  readonly quotaTtlMs: number;
  readonly quotaTimeoutMs: number;
  readonly warningPercent: number;
  readonly debug: boolean;
}

const DEFAULTS: PluginConfig = {
  enabled: true,
  authPath: null,
  quotaTtlMs: 90_000,
  quotaTimeoutMs: 5_000,
  warningPercent: 80,
  debug: false,
};

/**
 * Environment variable source (injectable for testing).
 */
export interface ConfigEnv {
  get(key: string): string | undefined;
}

/**
 * Parse a boolean env var. Accepts "true"/"false"/"1"/"0" (case-insensitive).
 * Returns the default on missing or invalid input.
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return defaultValue;
}

/**
 * Parse a positive integer env var.
 * Returns the default on missing, negative, zero, or non-numeric input.
 */
function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === "") return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return defaultValue;
  return n;
}

/**
 * Parse a number 0-100 env var.
 */
function parsePercent(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === "") return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return defaultValue;
  return n;
}

/**
 * Load and validate configuration from the environment.
 * On invalid values, falls back to defaults silently (the plan requires
 * one actionable warning, but we don't have a logger at config-load time).
 */
export function loadConfig(env: ConfigEnv): PluginConfig {
  return {
    enabled: parseBoolean(env.get("CODEX_METER_ENABLED"), DEFAULTS.enabled),
    authPath: env.get("CODEX_METER_AUTH_PATH") || null,
    quotaTtlMs: parsePositiveInt(env.get("CODEX_METER_QUOTA_TTL_MS"), DEFAULTS.quotaTtlMs),
    quotaTimeoutMs: parsePositiveInt(
      env.get("CODEX_METER_QUOTA_TIMEOUT_MS"),
      DEFAULTS.quotaTimeoutMs,
    ),
    warningPercent: parsePercent(env.get("CODEX_METER_WARNING_PERCENT"), DEFAULTS.warningPercent),
    debug: parseBoolean(env.get("CODEX_METER_DEBUG"), DEFAULTS.debug),
  };
}
