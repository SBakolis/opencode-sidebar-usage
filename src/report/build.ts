/**
 * Report model — combines session usage with an optional quota snapshot.
 *
 * All formatters (compact, detailed, JSON) consume this single model.
 * The model is immutable; formatters return strings or objects.
 */

import type { QuotaSnapshot } from "../quota/types";
import type { ModelUsage, SessionUsage } from "../session/types";

/**
 * A single model's usage in the report, sorted by total tracked tokens.
 */
export interface ReportModel {
  readonly providerID: string;
  readonly modelID: string;
  readonly modelKey: string;
  readonly messageCount: number;
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** Sum of all five token measures, used for sorting. */
  readonly totalTracked: number;
}

/**
 * The combined report model.
 */
export interface Report {
  readonly sessionID: string;
  readonly generatedAt: string;
  readonly models: ReportModel[];
  readonly quota: QuotaSnapshot | null;
  readonly warningThreshold: number;
  /** True if any known window meets the warning threshold. */
  readonly isWarning: boolean;
}

/**
 * Build a report from session usage and an optional quota snapshot.
 *
 * Models are sorted by total tracked tokens (descending), then by
 * provider/model key (ascending) for deterministic ties.
 */
export function buildReport(
  sessionID: string,
  usage: SessionUsage,
  quota: QuotaSnapshot | null,
  options: { generatedAt: string; warningThreshold: number },
): Report {
  const models: ReportModel[] = [];
  for (const mu of usage.values()) {
    models.push(modelUsageToReportModel(mu));
  }

  // Sort: descending totalTracked, then ascending modelKey.
  models.sort((a, b) => {
    if (b.totalTracked !== a.totalTracked) return b.totalTracked - a.totalTracked;
    return a.modelKey.localeCompare(b.modelKey);
  });

  const isWarning = checkWarning(quota, options.warningThreshold);

  return {
    sessionID,
    generatedAt: options.generatedAt,
    models,
    quota,
    warningThreshold: options.warningThreshold,
    isWarning,
  };
}

function modelUsageToReportModel(mu: ModelUsage): ReportModel {
  const totalTracked = mu.input + mu.output + mu.reasoning + mu.cacheRead + mu.cacheWrite;
  return {
    providerID: mu.providerID,
    modelID: mu.modelID,
    modelKey: `${mu.providerID}/${mu.modelID}`,
    messageCount: mu.messageCount,
    input: mu.input,
    output: mu.output,
    reasoning: mu.reasoning,
    cacheRead: mu.cacheRead,
    cacheWrite: mu.cacheWrite,
    totalTracked,
  };
}

function checkWarning(quota: QuotaSnapshot | null, threshold: number): boolean {
  if (!quota) return false;
  if (quota.status === "unavailable" || quota.status === "unauthenticated") return false;
  const fiveHourPct = quota.fiveHour?.usedPercent ?? 0;
  const weeklyPct = quota.weekly?.usedPercent ?? 0;
  return fiveHourPct >= threshold || weeklyPct >= threshold;
}
