/**
 * Cached quota provider — wraps a QuotaProvider with TTL caching,
 * in-flight request deduplication, and stale-if-error fallback.
 *
 * Behavior:
 * - On `fetch()`: check cache. If fresh (within TTL), return cached.
 * - If cache is expired or missing, fetch fresh from the inner provider.
 * - Deduplicate concurrent fetches (share one promise).
 * - On fetch failure: return the last successful snapshot marked `stale`
 *   if it's not too old. Otherwise return the error snapshot.
 * - Do NOT cache `unauthenticated` for the full TTL — use a shorter
 *   negative cache (30s) so that a re-auth is picked up quickly.
 * - Keep the most recent successful snapshot for stale-if-error fallback.
 */

import type { Clock, QuotaProvider, QuotaSnapshot } from "./types";

/**
 * Configuration for the cached provider.
 */
export interface CachedProviderConfig {
  /** TTL for successful quota fetches (ms). */
  readonly ttlMs: number;
  /** TTL for unauthenticated/unsupported results (ms). Shorter so re-auth is picked up. */
  readonly negativeTtlMs: number;
  /** Maximum age for stale-if-error fallback (ms). */
  readonly staleMaxAgeMs: number;
}

/**
 * Dependencies for the cached provider.
 */
export interface CachedProviderDeps {
  readonly clock: Clock;
  readonly config: CachedProviderConfig;
}

/**
 * Cached entry in the cache.
 */
interface CacheEntry {
  readonly snapshot: QuotaSnapshot;
  readonly fetchedAt: number;
}

/**
 * Cached quota provider with dedup and stale fallback.
 */
export class CachedProvider implements QuotaProvider {
  private readonly inner: QuotaProvider;
  private readonly deps: CachedProviderDeps;
  private cache: CacheEntry | null = null;
  private lastGood: CacheEntry | null = null;
  private inFlight: Promise<QuotaSnapshot> | null = null;

  constructor(inner: QuotaProvider, deps: CachedProviderDeps) {
    this.inner = inner;
    this.deps = deps;
  }

  /**
   * Fetch a quota snapshot. Uses cache, deduplicates concurrent calls,
   * and falls back to stale data on error.
   */
  async fetch(): Promise<QuotaSnapshot> {
    const now = this.deps.clock.now();

    // Check cache.
    if (this.cache) {
      const ttl = this.isNegativeStatus(this.cache.snapshot.status)
        ? this.deps.config.negativeTtlMs
        : this.deps.config.ttlMs;
      if (now - this.cache.fetchedAt < ttl) {
        return this.cache.snapshot;
      }
    }

    // Check if a fetch is already in flight.
    if (this.inFlight) {
      return this.inFlight;
    }

    // Start a new fetch.
    this.inFlight = this.doFetch();
    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  /**
   * Perform the actual fetch, update cache, and handle stale fallback.
   */
  private async doFetch(): Promise<QuotaSnapshot> {
    const now = this.deps.clock.now();
    let snapshot: QuotaSnapshot;

    try {
      snapshot = await this.inner.fetch();
    } catch {
      // The inner provider should never throw, but just in case.
      snapshot = {
        status: "unavailable",
        fetchedAt: new Date(now).toISOString(),
        source: "none",
        planType: null,
        fiveHour: null,
        weekly: null,
        unknownWindows: [],
        credits: null,
        warningCode: "UNAVAILABLE",
      };
    }

    // Update cache.
    this.cache = { snapshot, fetchedAt: now };

    // Update last-known-good if this was a successful fetch.
    if (snapshot.status === "ok") {
      this.lastGood = { snapshot, fetchedAt: now };
    }

    // If the fetch failed and we have stale data, return it marked stale.
    if (snapshot.status !== "ok" && this.lastGood) {
      const age = now - this.lastGood.fetchedAt;
      if (age < this.deps.config.staleMaxAgeMs) {
        return {
          ...this.lastGood.snapshot,
          status: "stale",
          warningCode: snapshot.warningCode ?? "UNAVAILABLE",
        };
      }
    }

    return snapshot;
  }

  /**
   * Check if a status should use the shorter negative TTL.
   */
  private isNegativeStatus(status: QuotaSnapshot["status"]): boolean {
    return status === "unauthenticated" || status === "unsupported";
  }

  /**
   * Force a cache clear (e.g. after a successful OpenAI message).
   */
  invalidate(): void {
    this.cache = null;
  }
}
