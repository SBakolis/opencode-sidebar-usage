/**
 * SidebarContent — the full sidebar panel.
 *
 * Composes:
 * - Title: "Codex Meter"
 * - Quota section: 5h and weekly bars + reset info
 * - Token section: per-model table + total
 *
 * Handles degraded states:
 * - No active session: "No active session"
 * - No messages yet: handled by TokenTable
 * - Quota unavailable: handled by QuotaBar
 */

import type { Report } from "../report/build";
import { formatResetDuration } from "../report/detailed";
import { QuotaBar } from "./quota-bar";
import type { ThemeColors } from "./theme";
import { TokenTable } from "./token-table";

export interface SidebarContentProps {
  report: Report | null;
  sessionID: string | null;
  colors: ThemeColors;
}

export function SidebarContent(props: SidebarContentProps) {
  if (!props.sessionID) {
    return (
      <box style={{ border: true, borderColor: props.colors.border, padding: 1 }}>
        <text style={{ fg: props.colors.textMuted }}>No active session</text>
      </box>
    );
  }

  const report = props.report;
  const quota = report?.quota ?? null;
  const showQuota =
    quota !== null &&
    quota.status !== "unavailable" &&
    quota.status !== "unauthenticated" &&
    quota.status !== "unsupported";

  return (
    <box
      style={{
        border: true,
        borderColor: props.colors.border,
        padding: 1,
        flexDirection: "column",
      }}
    >
      <text style={{ fg: props.colors.text }}>
        <strong>Codex Meter</strong>
      </text>

      {showQuota && quota && (
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          <text style={{ fg: props.colors.textMuted }}>Quota</text>
          <QuotaBar label="5h   " window={quota.fiveHour} colors={props.colors} barWidth={14} />
          <QuotaBar label="week " window={quota.weekly} colors={props.colors} barWidth={14} />
          {quota.fiveHour?.resetAfterSeconds != null && (
            <text style={{ fg: props.colors.textMuted }}>
              {`       resets ${formatResetDuration(quota.fiveHour.resetAfterSeconds)}`}
            </text>
          )}
        </box>
      )}

      {quota !== null && !showQuota && (
        <text style={{ fg: props.colors.textMuted, marginTop: 1 }}>{`Quota: ${quota.status}`}</text>
      )}

      <box style={{ flexDirection: "column", marginTop: 1 }}>
        <text style={{ fg: props.colors.textMuted }}>Tokens (this session)</text>
        <TokenTable models={report?.models ?? []} colors={props.colors} />
      </box>
    </box>
  );
}
