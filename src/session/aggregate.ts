/**
 * Pure, idempotent session token aggregation core.
 *
 * This module has zero runtime dependencies on OpenCode SDK types,
 * filesystem, network, or clocks. It is fully testable in isolation.
 *
 * Core invariant: snapshots are keyed by (sessionID, messageID).
 * A repeated `upsert` for the same messageID REPLACES the previous
 * snapshot; it never increments from event deltas. This is the
 * double-counting prevention rule.
 */

import { InvalidSnapshotError, TokenOverflowError } from "../errors";
import type { AssistantMessageSnapshot, SessionUsage, TokenUsage } from "./types";
import { modelKey } from "./types";

/**
 * Internal store shape: Map<sessionID, Map<messageID, AssistantMessageSnapshot>>.
 * Each session holds its own message-id-keyed map of snapshots.
 */
type SessionMap = Map<string, Map<string, AssistantMessageSnapshot>>;

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Normalize a single token value to a safe non-negative integer.
 *
 * Policy:
 * - number, finite, >= 0, integer         → returned as-is
 * - number, finite, >= 0, fractional      → floored
 * - number, finite, negative              → 0 (clamped, not an error)
 * - NaN                                    → 0 (not an error)
 * - Infinity / -Infinity                   → throws TokenOverflowError
 * - non-number (string, object, etc.)     → 0 (not an error)
 *
 * @param field - field name for error reporting
 * @param value - raw value from SDK or event
 * @returns safe non-negative integer
 * @throws TokenOverflowError if value is infinite
 */
function normalizeToken(field: string, value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  if (!Number.isFinite(value)) {
    throw new TokenOverflowError(field, value);
  }
  if (value < 0) {
    return 0;
  }
  if (!Number.isInteger(value)) {
    return Math.floor(value);
  }
  return value;
}

/**
 * Normalize a full TokenUsage object from potentially-partial or
 * malformed input. All five fields are always present in the output.
 */
function normalizeTokens(raw: Partial<TokenUsage> | null | undefined): TokenUsage {
  const input = normalizeToken("input", raw?.input);
  const output = normalizeToken("output", raw?.output);
  const reasoning = normalizeToken("reasoning", raw?.reasoning);
  const cacheRead = normalizeToken("cacheRead", raw?.cacheRead);
  const cacheWrite = normalizeToken("cacheWrite", raw?.cacheWrite);
  return { input, output, reasoning, cacheRead, cacheWrite };
}

/**
 * Validate that a snapshot has non-empty identifying fields.
 * @throws InvalidSnapshotError if any required field is empty.
 */
function validateSnapshot(s: AssistantMessageSnapshot): void {
  if (!s.sessionID) {
    throw new InvalidSnapshotError("sessionID", "Snapshot sessionID must be a non-empty string.");
  }
  if (!s.messageID) {
    throw new InvalidSnapshotError("messageID", "Snapshot messageID must be a non-empty string.");
  }
  if (!s.providerID) {
    throw new InvalidSnapshotError("providerID", "Snapshot providerID must be a non-empty string.");
  }
  if (!s.modelID) {
    throw new InvalidSnapshotError("modelID", "Snapshot modelID must be a non-empty string.");
  }
}

/**
 * Add two TokenUsage objects field-by-field.
 * @throws TokenOverflowError if any field total exceeds MAX_SAFE_INTEGER.
 */
function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  const input = a.input + b.input;
  const output = a.output + b.output;
  const reasoning = a.reasoning + b.reasoning;
  const cacheRead = a.cacheRead + b.cacheRead;
  const cacheWrite = a.cacheWrite + b.cacheWrite;
  if (
    input > MAX_SAFE ||
    output > MAX_SAFE ||
    reasoning > MAX_SAFE ||
    cacheRead > MAX_SAFE ||
    cacheWrite > MAX_SAFE
  ) {
    throw new TokenOverflowError(
      "aggregate",
      Math.max(input, output, reasoning, cacheRead, cacheWrite),
    );
  }
  return { input, output, reasoning, cacheRead, cacheWrite };
}

/**
 * Check whether a value is a finite safe integer.
 */
function isSafeInteger(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n) && n <= MAX_SAFE && n >= 0;
}

/**
 * Pure session store for idempotent token aggregation.
 *
 * State is held in `Map<sessionID, Map<messageID, AssistantMessageSnapshot>>`.
 * All public methods that return data return defensive copies; callers
 * cannot mutate internal state through returned references.
 */
export class SessionStore {
  private readonly sessions: SessionMap = new Map();

  /**
   * Upsert a snapshot. If a snapshot for the same (sessionID, messageID)
   * already exists, it is REPLACED (not incremented). This is the core
   * idempotency rule: streaming `message.updated` events that emit many
   * updates for the same assistant message must not double-count.
   *
   * @throws InvalidSnapshotError if identifying fields are empty.
   * @throws TokenOverflowError if any token value is infinite.
   */
  upsert(snapshot: AssistantMessageSnapshot): void {
    validateSnapshot(snapshot);
    const normalized: AssistantMessageSnapshot = {
      sessionID: snapshot.sessionID,
      messageID: snapshot.messageID,
      providerID: snapshot.providerID,
      modelID: snapshot.modelID,
      tokens: normalizeTokens(snapshot.tokens),
    };
    let msgs = this.sessions.get(normalized.sessionID);
    if (!msgs) {
      msgs = new Map();
      this.sessions.set(normalized.sessionID, msgs);
    }
    msgs.set(normalized.messageID, normalized);
  }

  /**
   * Remove a single message's snapshot from a session.
   * @returns true if a snapshot was removed, false if it was not present.
   */
  remove(sessionID: string, messageID: string): boolean {
    const msgs = this.sessions.get(sessionID);
    if (!msgs) return false;
    return msgs.delete(messageID);
  }

  /**
   * Replace all snapshots for a session with the provided list.
   *
   * Messages that were previously stored for this session but are NOT
   * in the new list are dropped. This is the authoritative rescan
   * semantics: the session's message list is the source of truth, and
   * any message no longer returned by OpenCode (deleted, reverted,
   * compacted away) is removed from accounting.
   *
   * @throws InvalidSnapshotError if any snapshot has empty fields.
   * @throws TokenOverflowError if any token value is infinite.
   */
  replaceSession(sessionID: string, snapshots: readonly AssistantMessageSnapshot[]): void {
    const filtered = snapshots.filter((s) => s.sessionID === sessionID);
    const newMsgs = new Map<string, AssistantMessageSnapshot>();
    for (const s of filtered) {
      validateSnapshot(s);
      const normalized: AssistantMessageSnapshot = {
        sessionID: s.sessionID,
        messageID: s.messageID,
        providerID: s.providerID,
        modelID: s.modelID,
        tokens: normalizeTokens(s.tokens),
      };
      newMsgs.set(normalized.messageID, normalized);
    }
    if (newMsgs.size > 0) {
      this.sessions.set(sessionID, newMsgs);
    } else {
      // If the rescan returned no assistant messages, remove the session
      // entirely rather than leaving an empty map entry.
      this.sessions.delete(sessionID);
    }
  }

  /**
   * Get aggregated usage for a session, keyed by `${providerID}/${modelID}`.
   *
   * Returns a defensive copy; mutating the returned map does not affect
   * internal state.
   *
   * @returns a new Map<string, ModelUsage>. Empty if session is unknown.
   * @throws TokenOverflowError if aggregation would overflow MAX_SAFE_INTEGER.
   */
  getSessionUsage(sessionID: string): SessionUsage {
    const msgs = this.sessions.get(sessionID);
    if (!msgs) return new Map();
    const usage: SessionUsage = new Map();
    for (const snap of msgs.values()) {
      const key = modelKey(snap.providerID, snap.modelID);
      const existing = usage.get(key);
      if (existing) {
        const combined = addTokens(existing, snap.tokens);
        usage.set(key, {
          providerID: snap.providerID,
          modelID: snap.modelID,
          messageCount: existing.messageCount + 1,
          ...combined,
        });
      } else {
        usage.set(key, {
          providerID: snap.providerID,
          modelID: snap.modelID,
          messageCount: 1,
          ...snap.tokens,
        });
      }
    }
    return usage;
  }

  /**
   * Delete all state for a session. Releases all stored snapshots.
   * @returns true if the session existed and was deleted.
   */
  deleteSession(sessionID: string): boolean {
    return this.sessions.delete(sessionID);
  }

  /**
   * Check whether a session is currently tracked.
   */
  hasSession(sessionID: string): boolean {
    return this.sessions.has(sessionID);
  }

  /**
   * Get the number of distinct messages tracked for a session.
   * Returns 0 for unknown sessions.
   */
  messageCount(sessionID: string): number {
    const msgs = this.sessions.get(sessionID);
    return msgs ? msgs.size : 0;
  }

  /**
   * Get a snapshot for a specific message, or undefined.
   * Returns a defensive copy.
   */
  getSnapshot(sessionID: string, messageID: string): AssistantMessageSnapshot | undefined {
    const msgs = this.sessions.get(sessionID);
    if (!msgs) return undefined;
    const snap = msgs.get(messageID);
    return snap ? { ...snap, tokens: { ...snap.tokens } } : undefined;
  }

  /**
   * Get the list of all tracked session IDs.
   * Returns a defensive copy array.
   */
  sessionIDs(): string[] {
    return [...this.sessions.keys()];
  }

  /**
   * Check whether a token value would pass normalization without error.
   * Exposed for testing.
   */
  static isSafeInteger(n: number): boolean {
    return isSafeInteger(n);
  }

  /**
   * Normalize a token value. Exposed for testing.
   */
  static normalizeToken(field: string, value: unknown): number {
    return normalizeToken(field, value);
  }
}
