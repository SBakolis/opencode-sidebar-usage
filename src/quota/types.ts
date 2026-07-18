/**
 * Quota types and interfaces.
 *
 * These types are the boundary between the quota provider implementations
 * (wham, future official) and the rest of the plugin. Core modules work
 * with `QuotaSnapshot` and never touch HTTP or auth details.
 */

/**
 * Status of a quota fetch attempt.
 * - `ok`: fresh data from the provider.
 * - `stale`: cached data returned after a refresh failure.
 * - `unauthenticated`: credentials missing, expired, or rejected (401/403).
 * - `unsupported`: the provider doesn't support this auth type (e.g. API key).
 * - `unavailable`: network error, timeout, server error, or schema drift.
 */
export type QuotaStatus = "ok" | "stale" | "unauthenticated" | "unsupported" | "unavailable";

/**
 * A single usage window (5-hour, weekly, or unknown).
 *
 * Windows are identified by duration, not by response position.
 * `windowSeconds` is the total window duration; `resetAfterSeconds`
 * is how long until the window resets.
 */
export interface UsageWindow {
  readonly kind: "five-hour" | "weekly" | "unknown";
  readonly usedPercent: number;
  readonly windowSeconds: number;
  readonly resetsAt: string | null;
  readonly resetAfterSeconds: number | null;
}

/**
 * Credits information from the quota response.
 */
export interface CreditsInfo {
  readonly hasCredits: boolean;
  readonly unlimited: boolean;
  readonly balance: string | null;
}

/**
 * A complete quota snapshot. This is the normalized representation
 * that all report formatters consume.
 */
export interface QuotaSnapshot {
  readonly status: QuotaStatus;
  readonly fetchedAt: string;
  readonly source: "opencode" | "chatgpt-wham" | "none";
  readonly planType: string | null;
  readonly fiveHour: UsageWindow | null;
  readonly weekly: UsageWindow | null;
  readonly unknownWindows: UsageWindow[];
  readonly credits: CreditsInfo | null;
  readonly warningCode: string | null;
}

/**
 * A "no quota" snapshot for when quota is unavailable.
 */
export function noQuotaSnapshot(
  status: QuotaStatus,
  warningCode: string,
  source: QuotaSnapshot["source"] = "none",
): QuotaSnapshot {
  return {
    status,
    fetchedAt: new Date(0).toISOString(),
    source,
    planType: null,
    fiveHour: null,
    weekly: null,
    unknownWindows: [],
    credits: null,
    warningCode,
  };
}

/**
 * Identify a window by its duration in seconds.
 *
 * - 18,000 seconds (±300) → "five-hour"
 * - 604,800 seconds (±3,600) → "weekly"
 * - anything else → "unknown"
 *
 * This is order-independent: we never rely on primary/secondary position.
 */
export function identifyWindow(seconds: number): UsageWindow["kind"] {
  if (Math.abs(seconds - 18_000) < 300) return "five-hour";
  if (Math.abs(seconds - 604_800) < 3_600) return "weekly";
  return "unknown";
}

/**
 * Quota provider interface. Implementations (wham, future official)
 * are behind this interface. The cache wraps a provider.
 */
export interface QuotaProvider {
  /**
   * Fetch a fresh quota snapshot. Never throws; returns a snapshot
   * with an error status on failure.
   */
  fetch(): Promise<QuotaSnapshot>;
}

/**
 * Injectable HTTP transport for the wham provider.
 */
export interface HttpTransport {
  fetch(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      signal: AbortSignal;
    },
  ): Promise<HttpResponse>;
}

/**
 * HTTP response interface for the transport.
 */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * Injectable clock for the cache.
 */
export interface Clock {
  now(): number;
}

/**
 * Stable warning codes.
 */
export const WarningCode = {
  AUTH_REQUIRED: "AUTH_REQUIRED",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  SCHEMA_CHANGED: "SCHEMA_CHANGED",
  UNAVAILABLE: "UNAVAILABLE",
} as const;
