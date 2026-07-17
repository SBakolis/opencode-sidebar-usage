/**
 * QuotaBar — renders a single quota window as label + progress bar + percentage.
 *
 * Used by <SidebarContent> for the 5-hour and weekly windows.
 * When `percent` is null (no data), renders a muted "unavailable" label.
 */

import type { UsageWindow } from "../quota/types";
import type { ThemeColors } from "./theme";

export interface QuotaBarProps {
  label: string;
  window: UsageWindow | null;
  colors: ThemeColors;
  barWidth: number;
}

export function QuotaBar(props: QuotaBarProps) {
  const percent = props.window ? Math.round(props.window.usedPercent) : null;

  if (percent === null) {
    return <text style={{ fg: props.colors.textMuted }}>{`${props.label}  unavailable`}</text>;
  }

  const filled = Math.round((percent / 100) * props.barWidth);
  const empty = props.barWidth - filled;
  const barColor = props.colors.quotaColor(percent);

  return (
    <text style={{ fg: props.colors.text }}>
      <span style={{ fg: props.colors.textMuted }}>{`${props.label}  `}</span>
      <span style={{ fg: barColor }}>{"█".repeat(filled)}</span>
      <span style={{ fg: props.colors.textMuted }}>{"░".repeat(empty)}</span>
      <span style={{ fg: barColor }}>{`  ${percent}%`}</span>
    </text>
  );
}
