/**
 * opencode-codex-meter — legacy server entry (package `main`).
 *
 * OpenCode < 1.3.4 imports the installed package directory, which resolves
 * through `main` rather than `exports`, and then calls every module export
 * as a plugin function. Newer hosts resolve `exports["./server"]` instead.
 *
 * Only the plugin function is exported: a non-function export would throw
 * in those loaders, and a second (named) export would initialize the plugin
 * twice on versions without export de-duplication.
 */

import { CodexMeterPlugin } from "./plugin";

export default CodexMeterPlugin;
