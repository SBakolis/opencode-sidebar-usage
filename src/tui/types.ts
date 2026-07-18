/**
 * TUI plugin internal types.
 *
 * Re-exports `TuiThemeCurrent` from the plugin SDK so the rest of the
 * TUI module doesn't import the SDK directly. This is the boundary.
 */

import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui";

export type { TuiThemeCurrent };
