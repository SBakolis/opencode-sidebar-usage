/**
 * Detailed terminal/tool formatter.
 *
 * Produces a multi-line string suitable for the `codex_usage` tool
 * output and the CLI human-readable report.
 *
 * Format:
 *   Codex subscription
 *     5h:       37% used · resets in 2h 14m
 *     Weekly:   62% used · resets Mon 10:00
 *     Credits:  14.50
 *
 *   Current OpenCode session
 *     openai/gpt-5.5
 *       Input:       184,230
 *       Output:        8,491
 *       Reasoning:    21,048
 *       Cache read:  421,120
 *       Cache write:      0
 */

import type { Report, ReportModel } from "./build";

/**
 * Format a number with comma-separated thousands.
 */
export function detailedNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Format a reset duration from seconds into a human-readable string.
 * - Under 1 hour: "Xm"
 * - 1-24 hours: "Xh Ym"
 * - Over 24 hours: "Xd Yh"
 */
export function formatResetDuration(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds <= 0) return "now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return `${d}d ${remH}h`;
}

/**
 * Format the quota section of the detailed report.
 */
function formatQuotaSection(report: Report): string {
  const q = report.quota;
  if (!q) {
    return "Codex subscription\n  Quota data unavailable.\n";
  }

  const lines: string[] = ["Codex subscription"];

  if (q.status === "unavailable" || q.status === "unauthenticated" || q.status === "unsupported") {
    const reason =
      q.status === "unauthenticated"
        ? "Not authenticated. Run `opencode auth login -p openai` to refresh."
        : q.status === "unsupported"
          ? "Auth type not supported for quota lookup."
          : "Quota endpoint unavailable.";
    lines.push(`  ${reason}`);
    if (q.warningCode) lines.push(`  Code: ${q.warningCode}`);
    return `${lines.join("\n")}\n`;
  }

  const staleLabel = q.status === "stale" ? " (stale)" : "";

  if (q.fiveHour) {
    const pct = Math.round(q.fiveHour.usedPercent);
    const reset = formatResetDuration(q.fiveHour.resetAfterSeconds);
    lines.push(`  5h:       ${pct}% used${staleLabel} · resets in ${reset}`);
  }

  if (q.weekly) {
    const pct = Math.round(q.weekly.usedPercent);
    const reset = formatResetDuration(q.weekly.resetAfterSeconds);
    lines.push(`  Weekly:   ${pct}% used${staleLabel} · resets in ${reset}`);
  }

  if (q.credits) {
    if (q.credits.unlimited) {
      lines.push("  Credits:  unlimited");
    } else if (q.credits.balance !== null) {
      lines.push(`  Credits:  ${q.credits.balance}`);
    }
  }

  if (q.planType) {
    lines.push(`  Plan:     ${q.planType}`);
  }

  // Unknown windows
  for (const w of q.unknownWindows) {
    const pct = Math.round(w.usedPercent);
    const reset = formatResetDuration(w.resetAfterSeconds);
    lines.push(`  Unknown (${w.windowSeconds}s): ${pct}% used · resets in ${reset}`);
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Format a single model's usage block.
 */
function formatModelBlock(m: ReportModel): string {
  return [
    `  ${m.modelKey}  (${m.messageCount} msg${m.messageCount === 1 ? "" : "s"})`,
    `    Input:       ${detailedNumber(m.input)}`,
    `    Output:      ${detailedNumber(m.output)}`,
    `    Reasoning:   ${detailedNumber(m.reasoning)}`,
    `    Cache read:  ${detailedNumber(m.cacheRead)}`,
    `    Cache write: ${detailedNumber(m.cacheWrite)}`,
  ].join("\n");
}

/**
 * Format the full detailed report.
 */
export function formatDetailed(report: Report): string {
  const sections: string[] = [];

  // Quota section
  sections.push(formatQuotaSection(report));

  // Session section
  sections.push("Current OpenCode session");

  if (report.models.length === 0) {
    sections.push("  No assistant messages recorded yet.");
  } else {
    for (const m of report.models) {
      sections.push(formatModelBlock(m));
    }
  }

  return `${sections.join("\n")}\n`;
}
