/**
 * Compact toast formatter.
 *
 * Produces a single-line string suitable for `client.tui.showToast`.
 *
 * Format:
 *   5h 37% · week 62% | gpt-5.5: 184k in / 8.5k out
 *
 * When quota is unavailable:
 *   gpt-5.5: 184k in / 8.5k out
 *
 * When quota is stale:
 *   5h 37% (stale) · week 62% (stale) | gpt-5.5: 184k in / 8.5k out
 *
 * Multiple models:
 *   5h 37% | gpt-5.5: 184k in / 8.5k out +2 more
 */

import type { Report, ReportModel } from "./build";

/**
 * Format a number compactly: k for thousands, M for millions.
 * - 999 → "999"
 * - 1000 → "1k"
 * - 8500 → "8.5k"
 * - 184230 → "184k"
 * - 1000000 → "1M"
 * - 1250000 → "1.3M"
 */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = n / 1000;
    const rounded = Math.round(k * 10) / 10;
    if (rounded >= 10) return `${Math.round(rounded)}k`;
    if (Number.isInteger(rounded)) return `${rounded}k`;
    return `${rounded}k`;
  }
  const m = n / 1_000_000;
  const roundedM = Math.round(m * 10) / 10;
  if (roundedM >= 10) return `${Math.round(roundedM)}M`;
  if (Number.isInteger(roundedM)) return `${roundedM}M`;
  return `${roundedM}M`;
}

/**
 * Format the quota portion of the toast.
 */
function formatQuota(report: Report): string {
  const q = report.quota;
  if (
    !q ||
    q.status === "unavailable" ||
    q.status === "unauthenticated" ||
    q.status === "unsupported"
  ) {
    return "";
  }

  const staleLabel = q.status === "stale" ? " (stale)" : "";
  const parts: string[] = [];

  if (q.fiveHour) {
    parts.push(`5h ${Math.round(q.fiveHour.usedPercent)}%${staleLabel}`);
  }
  if (q.weekly) {
    parts.push(`week ${Math.round(q.weekly.usedPercent)}%${staleLabel}`);
  }

  return parts.join(" · ");
}

/**
 * Format the model portion of the toast.
 * Shows the top model and "+N more" if there are additional models.
 */
function formatModels(report: Report): string {
  if (report.models.length === 0) return "";

  const top = report.models[0] as ReportModel;
  let s = `${top.modelID}: ${compactNumber(top.input)} in / ${compactNumber(top.output)} out`;

  if (report.models.length > 1) {
    s += ` +${report.models.length - 1} more`;
  }

  return s;
}

/**
 * Format the full compact toast message.
 */
export function formatCompact(report: Report): string {
  const quotaPart = formatQuota(report);
  const modelPart = formatModels(report);

  if (quotaPart && modelPart) {
    return `${quotaPart} | ${modelPart}`;
  }
  if (quotaPart) {
    return quotaPart;
  }
  return modelPart || "No usage data";
}

/**
 * Determine the toast variant based on the report.
 */
export function toastVariant(report: Report): "info" | "success" | "warning" | "error" {
  if (report.isWarning) return "warning";
  if (report.models.length === 0) return "info";
  return "info";
}
