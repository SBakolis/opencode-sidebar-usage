/**
 * QuotaBar — renders a single quota window as label + progress bar +
 * percentage, plus an optional muted reset-countdown suffix ("resets 4h 5m").
 * When the suffix would overflow `maxWidth`, it renders on its own line
 * below the bar instead, aligned under the bar start.
 *
 * Used by <SidebarContent> for the 5-hour and weekly windows.
 * When `percent` is null (no data), renders a muted "unavailable" label.
 *
 * IMPORTANT (Solid reactivity): the component function body runs ONCE.
 * Reads of `props.window` are done inside JSX expressions / createMemo so
 * that the bar re-renders when the window prop changes.
 */

import { Show, createMemo } from "solid-js";
import type { UsageWindow } from "../quota/types";
import { resetPlacement } from "./compute";
import type { ThemeColors } from "./theme";

export interface QuotaBarProps {
  label: string;
  window: UsageWindow | null;
  colors: ThemeColors;
  barWidth: number;
  reset?: string | null;
  maxWidth?: number | null;
}

export function QuotaBar(props: QuotaBarProps) {
  const percent = createMemo(() => (props.window ? Math.round(props.window.usedPercent) : null));
  const placement = createMemo(() =>
    props.reset
      ? resetPlacement(
          props.label.length,
          props.barWidth,
          percent() ?? 0,
          props.reset,
          props.maxWidth ?? null,
        )
      : null,
  );

  return (
    <Show
      when={percent() !== null}
      fallback={<text style={{ fg: props.colors.textMuted }}>{`${props.label}  unavailable`}</text>}
    >
      <text style={{ fg: props.colors.text }}>
        <span style={{ fg: props.colors.textMuted }}>{`${props.label}  `}</span>
        <span style={{ fg: props.colors.quotaColor(percent() ?? 0) }}>
          {"█".repeat(Math.round(((percent() ?? 0) / 100) * props.barWidth))}
        </span>
        <span style={{ fg: props.colors.textMuted }}>
          {"░".repeat(props.barWidth - Math.round(((percent() ?? 0) / 100) * props.barWidth))}
        </span>
        <span style={{ fg: props.colors.quotaColor(percent() ?? 0) }}>{`  ${percent()}%`}</span>
        <Show when={placement() === "inline"}>
          <span style={{ fg: props.colors.textMuted }}>{`  ${props.reset}`}</span>
        </Show>
      </text>
      <Show when={placement() === "below"}>
        <text style={{ fg: props.colors.textMuted }}>
          {`${" ".repeat(props.label.length + 2)}${props.reset}`}
        </text>
      </Show>
    </Show>
  );
}
