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
 *
 * IMPORTANT (Solid reactivity): the component function body runs ONCE.
 * Destructuring props (e.g. `const report = props.report`) captures the
 * initial value and never updates. All prop reads that must react to
 * changes are done inside JSX expressions or via `createMemo`.
 */

import { Show, createMemo } from "solid-js";
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
  // Reactive: re-evaluates whenever props.report changes.
  const quota = createMemo(() => props.report?.quota ?? null);
  const showQuota = createMemo(() => {
    const q = quota();
    return (
      q !== null &&
      q.status !== "unavailable" &&
      q.status !== "unauthenticated" &&
      q.status !== "unsupported"
    );
  });

  return (
    <Show
      when={props.sessionID}
      fallback={
        <box style={{ border: true, borderColor: props.colors.border, padding: 1 }}>
          <text style={{ fg: props.colors.textMuted }}>No active session</text>
        </box>
      }
    >
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

        <Show when={showQuota()}>
          <box style={{ flexDirection: "column", marginTop: 1 }}>
            <text style={{ fg: props.colors.textMuted }}>Quota</text>
            <QuotaBar
              label="5h   "
              window={quota()?.fiveHour ?? null}
              colors={props.colors}
              barWidth={14}
            />
            <QuotaBar
              label="week "
              window={quota()?.weekly ?? null}
              colors={props.colors}
              barWidth={14}
            />
            <Show when={quota()?.fiveHour?.resetAfterSeconds != null}>
              <text style={{ fg: props.colors.textMuted }}>
                {`       resets ${formatResetDuration(quota()?.fiveHour?.resetAfterSeconds ?? null)}`}
              </text>
            </Show>
          </box>
        </Show>

        <Show when={quota() !== null && !showQuota()}>
          <text
            style={{ fg: props.colors.textMuted, marginTop: 1 }}
          >{`Quota: ${quota()?.status}`}</text>
        </Show>

        <box style={{ flexDirection: "column", marginTop: 1 }}>
          <text style={{ fg: props.colors.textMuted }}>Tokens (this session)</text>
          <TokenTable models={props.report?.models ?? []} colors={props.colors} />
        </box>
      </box>
    </Show>
  );
}
