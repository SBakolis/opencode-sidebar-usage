/**
 * Stable internal data contracts for session token accounting.
 *
 * These types are the boundary between OpenCode SDK types (which are
 * version-dependent and isolated behind adapters) and the pure
 * aggregation / reporting core. Core modules must not import from
 * `@opencode-ai/sdk` or `@opencode-ai/plugin`.
 *
 * Token values are always integers >= 0. Missing optional fields
 * normalize to zero; malformed or negative values must not poison totals.
 */

/**
 * Per-message token usage, broken into five separate measures.
 * Input and output are always shown separately in every report format.
 * Reasoning, cache-read, and cache-write are kept distinct from output.
 */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/**
 * A complete snapshot of an assistant message's token usage.
 *
 * Snapshots are keyed by (sessionID, messageID). Repeated updates for
 * the same messageID replace the previous snapshot; they never
 * increment from event deltas. This is the core idempotency rule.
 */
export interface AssistantMessageSnapshot {
  readonly sessionID: string;
  readonly messageID: string;
  readonly providerID: string;
  readonly modelID: string;
  readonly tokens: TokenUsage;
}

/**
 * Aggregated usage for a single provider/model pair within a session.
 *
 * Extends TokenUsage so the aggregate carries the same five measures.
 * `messageCount` is the number of distinct assistant messages that
 * contributed to this total.
 */
export interface ModelUsage extends TokenUsage {
  readonly providerID: string;
  readonly modelID: string;
  readonly messageCount: number;
}

/**
 * Per-session usage, keyed by `${providerID}/${modelID}`.
 *
 * Returned by `getSessionUsage` as a defensive copy; callers cannot
 * mutate internal store state through the returned map.
 */
export type SessionUsage = Map<string, ModelUsage>;

/**
 * Model key format: `${providerID}/${modelID}`.
 * Used consistently across aggregation, reporting, and JSON output.
 */
export function modelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}
