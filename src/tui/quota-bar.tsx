/**
 * QuotaBar — renders a single quota window as label + progress bar + percentage.
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
import type { ThemeColors } from "./theme";

export interface QuotaBarProps {
  label: string;
  window: UsageWindow | null;
  colors: ThemeColors;
  barWidth: number;
}

export function QuotaBar(props: QuotaBarProps) {
  const percent = createMemo(() => (props.window ? Math.round(props.window.usedPercent) : null));

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
      </text>
    </Show>
  );
}
