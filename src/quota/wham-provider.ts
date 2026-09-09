/**
 * wham provider — fetches Codex subscription usage from the unsupported
 * ChatGPT backend endpoint.
 *
 * URL: GET https://chatgpt.com/backend-api/wham/usage
 * Headers:
 *   Authorization: Bearer <access-token>
 *   ChatGPT-Account-Id: <account-id>   (only if accountId is present)
 *
 * This endpoint is unsupported and undocumented by OpenAI. It may
 * change or disappear without notice. The module isolates all
 * endpoint-specific logic here; the rest of the plugin works with
 * the normalized QuotaSnapshot.
 *
 * Failure handling:
 * - 401/403 → unauthenticated, AUTH_REQUIRED
 * - 429 → unavailable (or stale if cached), RATE_LIMITED
 * - timeout → unavailable (or stale), TIMEOUT
 * - 5xx/network → unavailable (or stale), UNAVAILABLE
 * - malformed JSON / schema drift → unavailable, SCHEMA_CHANGED
 *
 * Never throws. Never refreshes OAuth. Never logs the access token.
 */

import type { Credentials } from "./auth-reader";
import { parseWhamResponse } from "./schemas";
import type {
  Clock,
  HttpResponse,
  HttpTransport,
  QuotaProvider,
  QuotaSnapshot,
  UsageWindow,
} from "./types";
import { WarningCode, noQuotaSnapshot } from "./types";

const WHAM_URL = "https://chatgpt.com/backend-api/wham/usage";

/**
 * Configuration for the wham provider.
 */
export interface WhamProviderConfig {
  readonly timeoutMs: number;
}

/**
 * Dependencies for the wham provider (all injectable).
 */
export interface WhamProviderDeps {
  readonly transport: HttpTransport;
  readonly clock: Clock;
  readonly config: WhamProviderConfig;
}

/**
 * Credential provider function — returns fresh credentials on each call.
 * The AuthReader satisfies this interface.
 */
export type CredentialProvider = () => Promise<Credentials>;

/**
 * Build a QuotaSnapshot from a parsed wham response.
 */
function buildSnapshot(
  windows: UsageWindow[],
  planType: string | null,
  credits: QuotaSnapshot["credits"],
  fetchedAt: string,
): QuotaSnapshot {
  const fiveHour = windows.find((w) => w.kind === "five-hour") ?? null;
  const weekly = windows.find((w) => w.kind === "weekly") ?? null;
  const unknownWindows = windows.filter((w) => w.kind === "unknown");

  return {
    status: "ok",
    fetchedAt,
    source: "chatgpt-wham",
    planType,
    fiveHour,
    weekly,
    unknownWindows,
    credits,
    warningCode: null,
  };
}

/**
 * wham QuotaProvider implementation.
 *
 * Fetches quota from the ChatGPT backend wham endpoint using the
 * OpenAI OAuth access token. Never refreshes, never writes, never
 * throws.
 */
export class WhamProvider implements QuotaProvider {
  private readonly deps: WhamProviderDeps;
  private readonly getCredentials: CredentialProvider;

  constructor(deps: WhamProviderDeps, getCredentials: CredentialProvider) {
    this.deps = deps;
    this.getCredentials = getCredentials;
  }

  async fetch(): Promise<QuotaSnapshot> {
    // Read credentials fresh on each call (AuthReader doesn't cache).
    const creds = await this.getCredentials();

    // Check credential status.
    if (
      creds.status === "unauthenticated" ||
      creds.status === "expired" ||
      creds.status === "malformed"
    ) {
      return noQuotaSnapshot("unauthenticated", WarningCode.AUTH_REQUIRED, "chatgpt-wham");
    }
    if (creds.status === "unsupported") {
      return noQuotaSnapshot("unsupported", WarningCode.AUTH_REQUIRED, "chatgpt-wham");
    }
    if (creds.status === "missing-account-id") {
      // The wham endpoint requires ChatGPT-Account-Id.
      return noQuotaSnapshot("unauthenticated", WarningCode.AUTH_REQUIRED, "chatgpt-wham");
    }
    if (creds.status !== "ok" || !creds.accessToken) {
      return noQuotaSnapshot("unauthenticated", WarningCode.AUTH_REQUIRED, "chatgpt-wham");
    }

    // Build request headers. Only the required headers.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.accessToken}`,
    };
    if (creds.accountId) {
      headers["ChatGPT-Account-Id"] = creds.accountId;
    }

    // Create abort controller for timeout.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.deps.config.timeoutMs);

    let response: HttpResponse;
    try {
      response = await this.deps.transport.fetch(WHAM_URL, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // Check if it was a timeout (abort).
      if (err instanceof Error && err.name === "AbortError") {
        return noQuotaSnapshot("unavailable", WarningCode.TIMEOUT, "chatgpt-wham");
      }
      return noQuotaSnapshot("unavailable", WarningCode.UNAVAILABLE, "chatgpt-wham");
    }
    clearTimeout(timeoutId);

    // Handle HTTP status codes.
    if (response.status === 401 || response.status === 403) {
      return noQuotaSnapshot("unauthenticated", WarningCode.AUTH_REQUIRED, "chatgpt-wham");
    }
    if (response.status === 429) {
      return noQuotaSnapshot("unavailable", WarningCode.RATE_LIMITED, "chatgpt-wham");
    }
    if (response.status >= 500) {
      return noQuotaSnapshot("unavailable", WarningCode.UNAVAILABLE, "chatgpt-wham");
    }
    if (!response.ok) {
      return noQuotaSnapshot("unavailable", WarningCode.UNAVAILABLE, "chatgpt-wham");
    }

    // Parse JSON body.
    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return noQuotaSnapshot("unavailable", WarningCode.SCHEMA_CHANGED, "chatgpt-wham");
    }

    // Validate and normalize.
    const parsed = parseWhamResponse(raw);
    if (!parsed.ok) {
      return noQuotaSnapshot("unavailable", WarningCode.SCHEMA_CHANGED, "chatgpt-wham");
    }

    // Build the snapshot.
    const fetchedAt = new Date(this.deps.clock.now()).toISOString();
    return buildSnapshot(parsed.windows, parsed.planType, parsed.credits, fetchedAt);
  }
}
