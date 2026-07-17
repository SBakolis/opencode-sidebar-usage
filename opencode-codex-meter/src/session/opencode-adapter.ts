/**
 * Narrow adapter around the OpenCode SDK types.
 *
 * This module is the ONLY place that knows about SDK-specific field
 * names (e.g. `tokens.cache.read` vs our `cacheRead`). Core modules
 * work with `AssistantMessageSnapshot` and never touch SDK shapes.
 *
 * The SDK types verified in Checkpoint 0:
 * - AssistantMessage.tokens: { input, output, reasoning, cache: { read, write } }
 * - session.messages() returns { data: Array<{ info: Message, parts: Array<Part> }> }
 * - Event payloads: message.updated.properties.info, message.removed.properties.{sessionID,messageID}, etc.
 */

import type { AssistantMessageSnapshot, TokenUsage } from "./types";

/**
 * Narrow representation of an SDK Message. Only the fields we actually
 * read. `role` discriminates user vs assistant.
 */
export interface SdkMessage {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  // Assistant-only fields (present when role === "assistant"):
  providerID?: string;
  modelID?: string;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}

/**
 * Narrow shape of the SDK session.messages() response. The real SDK
 * returns a `RequestResult` with `.data` and `.error`; we model only
 * what we need.
 */
export interface SdkMessagesResult {
  data?: Array<{ info: SdkMessage }>;
  error?: unknown;
}

/**
 * Narrow event shape. The real SDK `Event` union has ~30 variants;
 * we accept a structural shape and dispatch on `type`.
 */
export interface SdkEvent {
  type: string;
  properties: unknown;
}

/**
 * Convert an SDK message to our internal snapshot.
 *
 * Returns `null` for:
 * - Non-assistant messages (role !== "assistant").
 * - Assistant messages missing providerID or modelID (malformed).
 *
 * Token fields are mapped from SDK shape (`cache.read` → `cacheRead`)
 * and missing values are left as-is (the SessionStore normalizes them
 * to zero).
 */
export function messageToSnapshot(msg: SdkMessage): AssistantMessageSnapshot | null {
  if (msg.role !== "assistant") return null;
  if (!msg.providerID || !msg.modelID) return null;
  if (!msg.sessionID || !msg.id) return null;

  const tokens: TokenUsage = {
    input: msg.tokens?.input ?? 0,
    output: msg.tokens?.output ?? 0,
    reasoning: msg.tokens?.reasoning ?? 0,
    cacheRead: msg.tokens?.cache?.read ?? 0,
    cacheWrite: msg.tokens?.cache?.write ?? 0,
  };

  return {
    sessionID: msg.sessionID,
    messageID: msg.id,
    providerID: msg.providerID,
    modelID: msg.modelID,
    tokens,
  };
}

/**
 * Extract assistant snapshots from an SDK session.messages() result.
 *
 * Filters for assistant messages only and ensures all snapshots belong
 * to the requested session (defensive: the SDK should already guarantee
 * this, but we don't trust it).
 */
export function resultToSnapshots(
  result: SdkMessagesResult,
  sessionID: string,
): AssistantMessageSnapshot[] {
  if (!result.data) return [];
  const snapshots: AssistantMessageSnapshot[] = [];
  for (const item of result.data) {
    const snap = messageToSnapshot(item.info);
    if (snap && snap.sessionID === sessionID) {
      snapshots.push(snap);
    }
  }
  return snapshots;
}

// ── Event extraction helpers ──────────────────────────────────────────

/**
 * Extract a snapshot from a `message.updated` event.
 * Returns null for non-assistant messages.
 */
export function extractMessageUpdated(event: SdkEvent): AssistantMessageSnapshot | null {
  if (event.type !== "message.updated") return null;
  const props = event.properties as { info?: SdkMessage };
  if (!props?.info) return null;
  return messageToSnapshot(props.info);
}

/**
 * Extract IDs from a `message.removed` event.
 */
export function extractMessageRemoved(
  event: SdkEvent,
): { sessionID: string; messageID: string } | null {
  if (event.type !== "message.removed") return null;
  const props = event.properties as { sessionID?: string; messageID?: string };
  if (!props?.sessionID || !props?.messageID) return null;
  return { sessionID: props.sessionID, messageID: props.messageID };
}

/**
 * Extract the sessionID from a `session.idle` event.
 */
export function extractSessionIdle(event: SdkEvent): string | null {
  if (event.type !== "session.idle") return null;
  const props = event.properties as { sessionID?: string };
  return props?.sessionID ?? null;
}

/**
 * Extract the sessionID from a `session.compacted` event.
 */
export function extractSessionCompacted(event: SdkEvent): string | null {
  if (event.type !== "session.compacted") return null;
  const props = event.properties as { sessionID?: string };
  return props?.sessionID ?? null;
}

/**
 * Extract the sessionID from a `session.deleted` event.
 * The SDK payload has `properties.info.id` (the Session object).
 */
export function extractSessionDeleted(event: SdkEvent): string | null {
  if (event.type !== "session.deleted") return null;
  const props = event.properties as { info?: { id?: string }; sessionID?: string };
  // session.deleted has properties.info.id; some variants might have sessionID directly
  return props?.info?.id ?? props?.sessionID ?? null;
}
