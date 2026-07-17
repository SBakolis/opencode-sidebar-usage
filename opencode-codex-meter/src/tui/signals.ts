/**
 * Solid reactive signals for the TUI plugin.
 *
 * These signals are the bridge between event handlers (which set data)
 * and JSX components (which read data and re-render).
 *
 * Signals are created once at plugin init and shared across all
 * components and event handlers.
 */

import { createSignal } from "solid-js";
import type { QuotaSnapshot } from "../quota/types";
import type { Report } from "../report/build";

export type ReportSignal = ReturnType<typeof createSignal<Report | null>>;
export type QuotaSignal = ReturnType<typeof createSignal<QuotaSnapshot | null>>;
export type SessionSignal = ReturnType<typeof createSignal<string | null>>;

export interface TuiSignals {
  readonly report: ReportSignal;
  readonly quota: QuotaSignal;
  readonly sessionID: SessionSignal;
}

export function createTuiSignals(): TuiSignals {
  return {
    report: createSignal<Report | null>(null),
    quota: createSignal<QuotaSnapshot | null>(null),
    sessionID: createSignal<string | null>(null),
  };
}
