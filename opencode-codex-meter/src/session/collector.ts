/**
 * Event-driven session collector.
 *
 * Bridges OpenCode SDK events and session.messages() calls to the
 * pure SessionStore. Responsibilities:
 *
 * - Hydrate sessions lazily via `session.messages()` on first relevant event.
 * - Deduplicate concurrent hydration per session (in-flight promise).
 * - Prevent stale hydration results from overwriting newer event state
 *   via a generation counter and a pending-updates queue.
 * - Dispatch on event types: message.updated, message.removed,
 *   session.idle, session.compacted, session.deleted.
 * - Keep child sessions separate (no parent/child aggregation in v1).
 *
 * All SDK interaction is behind the `CollectorClient` interface, which
 * is injectable for testing.
 */

import type { SessionStore } from "./aggregate";
import {
  type SdkEvent,
  type SdkMessagesResult,
  extractMessageRemoved,
  extractMessageUpdated,
  extractSessionCompacted,
  extractSessionDeleted,
  extractSessionIdle,
  resultToSnapshots,
} from "./opencode-adapter";
import type { AssistantMessageSnapshot, SessionUsage } from "./types";

/**
 * Narrow client interface for SDK interaction.
 * The real OpencodeClient satisfies this structurally.
 */
export interface CollectorClient {
  session: {
    messages(options: {
      path: { id: string };
      query?: { directory?: string; limit?: number };
    }): Promise<SdkMessagesResult>;
  };
}

/**
 * Sanitized logger interface. Must not receive secrets.
 */
export interface CollectorLogger {
  warn(message: string): void;
  debug(message: string): void;
}

/**
 * No-op logger that silently drops messages. Used when no logger is
 * injected. Useful for tests and for the disabled-plugin case.
 */
export const noopLogger: CollectorLogger = {
  warn() {},
  debug() {},
};

/**
 * Per-session pending operations that arrived during hydration.
 * These are re-applied after `replaceSession` so that events newer
 * than the API response are not lost.
 */
interface PendingOps {
  upserts: Map<string, AssistantMessageSnapshot>;
  removes: Set<string>;
}

export class SessionCollector {
  private readonly store: SessionStore;
  private readonly client: CollectorClient;
  private readonly directory?: string;
  private readonly logger: CollectorLogger;

  // In-flight hydration promises, per session.
  private readonly inFlight: Map<string, Promise<void>> = new Map();

  // Generation counter per session. Bumped on compaction and on
  // session.idle. A hydration that started at generation N is stale
  // if the current generation is > N.
  private readonly generations: Map<string, number> = new Map();

  // Pending upserts/removes that arrived during hydration.
  private readonly pending: Map<string, PendingOps> = new Map();

  constructor(
    client: CollectorClient,
    store: SessionStore,
    options?: { directory?: string; logger?: CollectorLogger },
  ) {
    this.client = client;
    this.store = store;
    this.directory = options?.directory;
    this.logger = options?.logger ?? noopLogger;
  }

  /**
   * Hydrate a session from `session.messages()`. Deduplicates concurrent
   * calls. Uses a generation counter to prevent stale results from
   * overwriting newer event-driven state.
   *
   * On success, calls `store.replaceSession()` and then re-applies any
   * pending operations that arrived during the API call.
   *
   * On failure (API error, network), logs a sanitized warning and does
   * NOT modify the store. Previously stored state is preserved.
   */
  async hydrate(sessionID: string): Promise<void> {
    // Deduplicate: if a hydration is already in flight, await it.
    const existing = this.inFlight.get(sessionID);
    if (existing) return existing;

    // Bump generation for this hydration cycle.
    const gen = (this.generations.get(sessionID) ?? 0) + 1;
    this.generations.set(sessionID, gen);

    // Initialize pending ops for this hydration cycle.
    this.pending.set(sessionID, { upserts: new Map(), removes: new Set() });

    const promise = this.doHydrate(sessionID, gen);
    this.inFlight.set(sessionID, promise);
    try {
      await promise;
    } finally {
      this.inFlight.delete(sessionID);
      this.pending.delete(sessionID);
    }
  }

  private async doHydrate(sessionID: string, gen: number): Promise<void> {
    let result: SdkMessagesResult;
    try {
      result = await this.client.session.messages({
        path: { id: sessionID },
        query: this.directory ? { directory: this.directory } : undefined,
      });
    } catch {
      this.logger.warn(`Failed to fetch messages for session ${sessionID}.`);
      return;
    }

    // Check if this hydration is stale (a compaction or newer idle occurred).
    const currentGen = this.generations.get(sessionID) ?? 0;
    if (gen < currentGen) {
      this.logger.debug(`Stale hydration for session ${sessionID}, discarding.`);
      return;
    }

    if (result.error || !result.data) {
      this.logger.warn(`Error fetching messages for session ${sessionID}.`);
      return;
    }

    const snapshots = resultToSnapshots(result, sessionID);

    // Note: there is no await between the gen check above and
    // replaceSession below, so the generation cannot advance in
    // JavaScript's single-threaded event loop. The check above is
    // sufficient; a second check would be unreachable.

    // Authoritative replace.
    this.store.replaceSession(sessionID, snapshots);

    // Re-apply pending operations that arrived during the API call.
    const ops = this.pending.get(sessionID);
    if (ops) {
      for (const snap of ops.upserts.values()) {
        this.store.upsert(snap);
      }
      for (const messageID of ops.removes) {
        this.store.remove(sessionID, messageID);
      }
    }
  }

  /**
   * Handle an SDK event. Dispatches on `event.type` and updates the
   * store. Never throws; errors are logged and swallowed.
   */
  async handleEvent(event: SdkEvent): Promise<void> {
    try {
      switch (event.type) {
        case "message.updated": {
          const snap = extractMessageUpdated(event);
          if (snap) {
            this.store.upsert(snap);
            // If hydration is in flight, record as pending so it
            // survives the replaceSession call.
            if (this.inFlight.has(snap.sessionID)) {
              const ops = this.pending.get(snap.sessionID);
              if (ops) {
                ops.upserts.set(snap.messageID, snap);
              }
            }
          }
          break;
        }
        case "message.removed": {
          const info = extractMessageRemoved(event);
          if (info) {
            this.store.remove(info.sessionID, info.messageID);
            if (this.inFlight.has(info.sessionID)) {
              const ops = this.pending.get(info.sessionID);
              if (ops) {
                ops.removes.add(info.messageID);
                // A remove cancels a pending upsert for the same message.
                ops.upserts.delete(info.messageID);
              }
            }
          }
          break;
        }
        case "session.idle": {
          const sessionID = extractSessionIdle(event);
          if (sessionID) {
            await this.hydrate(sessionID);
          }
          break;
        }
        case "session.compacted": {
          const sessionID = extractSessionCompacted(event);
          if (sessionID) {
            // Bump generation to invalidate any in-flight hydration.
            // The next session.idle will trigger an authoritative rescan.
            const g = this.generations.get(sessionID) ?? 0;
            this.generations.set(sessionID, g + 1);
          }
          break;
        }
        case "session.deleted": {
          const sessionID = extractSessionDeleted(event);
          if (sessionID) {
            this.store.deleteSession(sessionID);
            this.generations.delete(sessionID);
            this.pending.delete(sessionID);
          }
          break;
        }
        default:
          // Ignore events we don't handle.
          break;
      }
    } catch (err) {
      // Never let an event handler crash OpenCode.
      const msg = err instanceof Error ? err.message : "unknown error";
      this.logger.warn(`Error handling event ${event.type}: ${msg}`);
    }
  }

  /**
   * Get aggregated usage for a session. Returns a defensive copy.
   */
  getUsage(sessionID: string): SessionUsage {
    return this.store.getSessionUsage(sessionID);
  }

  /**
   * Check if a session is tracked.
   */
  hasSession(sessionID: string): boolean {
    return this.store.hasSession(sessionID);
  }

  /**
   * Get the underlying store. Exposed for plugin/tool access.
   */
  getStore(): SessionStore {
    return this.store;
  }
}
