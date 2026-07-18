/**
 * Theme color resolution for TUI components.
 *
 * Maps the OpenCode TUI theme's RGBA colors + the warning threshold
 * to a flat `ThemeColors` object that JSX components consume.
 *
 * Pure function — no JSX, no Solid, fully testable.
 */

import type { TuiThemeCurrent } from "./types";

export interface ThemeColors {
  readonly text: TuiThemeCurrent["text"];
  readonly textMuted: TuiThemeCurrent["textMuted"];
  readonly border: TuiThemeCurrent["border"];
  readonly quotaColor: (percent: number) => TuiThemeCurrent["success"];
}

export function resolveThemeColors(theme: TuiThemeCurrent, warningThreshold: number): ThemeColors {
  return {
    text: theme.text,
    textMuted: theme.textMuted,
    border: theme.border,
    quotaColor(percent: number) {
      if (percent >= 95) return theme.error;
      if (percent >= warningThreshold) return theme.warning;
      return theme.success;
    },
  };
}
