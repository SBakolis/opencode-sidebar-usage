/**
 * Pure function: convert SDK messages to a Report.
 *
 * This is the TUI plugin's compute layer. It takes the raw message list
 * from `api.state.session.messages()` and produces the same `Report`
 * model used by the server-side tool and CLI.
 *
 * No JSX, no Solid, no side effects — fully unit-testable.
 */

import type { QuotaSnapshot, UsageWindow } from "../quota/types";
import { type Report, buildReport } from "../report/build";
import { formatResetDuration } from "../report/detailed";
import { SessionStore } from "../session/aggregate";
import { type SdkMessage, messageToSnapshot } from "../session/opencode-adapter";

export function computeReport(
  sessionID: string,
  messages: SdkMessage[],
  quota: QuotaSnapshot | null,
  options: { generatedAt: string; warningThreshold: number },
): Report {
  const store = new SessionStore();

  for (const msg of messages) {
    const snapshot = messageToSnapshot(msg);
    if (snapshot) {
      store.upsert(snapshot);
    }
  }

  const usage = store.getSessionUsage(sessionID);
  return buildReport(sessionID, usage, quota, options);
}

/**
 * Live "resets 4h 5m" label for a usage window, or null when no reset
 * info is available. Prefers the absolute `resetsAt` timestamp; falls
 * back to `fetchedAt + resetAfterSeconds` so a cached snapshot doesn't
 * show a stale countdown. Clamped to 0 ("resets now") once past.
 */
export function resetDurationLabel(
  window: UsageWindow | null,
  fetchedAt: string | null,
  nowMs: number,
): string | null {
  if (!window) return null;

  let remainingSeconds: number | null = null;

  const resetsAtMs = window.resetsAt !== null ? Date.parse(window.resetsAt) : Number.NaN;
  if (!Number.isNaN(resetsAtMs)) {
    remainingSeconds = (resetsAtMs - nowMs) / 1000;
  } else if (window.resetAfterSeconds !== null) {
    const fetchedAtMs = fetchedAt !== null ? Date.parse(fetchedAt) : Number.NaN;
    remainingSeconds = Number.isNaN(fetchedAtMs)
      ? window.resetAfterSeconds
      : window.resetAfterSeconds + (fetchedAtMs - nowMs) / 1000;
  }

  if (remainingSeconds === null) return null;
  return `resets ${formatResetDuration(Math.max(0, Math.round(remainingSeconds)))}`;
}
