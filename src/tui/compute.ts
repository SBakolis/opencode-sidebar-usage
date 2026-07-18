/**
 * Pure function: convert SDK messages to a Report.
 *
 * This is the TUI plugin's compute layer. It takes the raw message list
 * from `api.state.session.messages()` and produces the same `Report`
 * model used by the server-side tool and CLI.
 *
 * No JSX, no Solid, no side effects — fully unit-testable.
 */

import type { QuotaSnapshot } from "../quota/types";
import { type Report, buildReport } from "../report/build";
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
