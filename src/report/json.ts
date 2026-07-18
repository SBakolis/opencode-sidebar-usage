/**
 * JSON report serializer with schemaVersion: 1.
 *
 * Produces a machine-readable JSON object. Additive fields are allowed
 * in future versions; breaking changes require a new schema version.
 *
 * No secrets (access tokens, refresh tokens, account IDs) appear in
 * the JSON output. The quota snapshot is already sanitized by the
 * provider; the session usage contains only token counts.
 */

import type { Report } from "./build";

/**
 * The JSON report schema. Version 1.
 */
export interface JsonReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly session: {
    readonly sessionID: string;
    readonly models: Array<{
      readonly providerID: string;
      readonly modelID: string;
      readonly messageCount: number;
      readonly input: number;
      readonly output: number;
      readonly reasoning: number;
      readonly cacheRead: number;
      readonly cacheWrite: number;
    }>;
  };
  readonly quota: {
    readonly status: string;
    readonly source: string;
    readonly fetchedAt: string;
    readonly planType: string | null;
    readonly fiveHour: object | null;
    readonly weekly: object | null;
    readonly unknownWindows: object[];
    readonly credits: object | null;
    readonly warningCode: string | null;
  } | null;
  readonly isWarning: boolean;
}

/**
 * Serialize a report to a JSON-compatible object.
 */
export function toJsonReport(report: Report): JsonReport {
  return {
    schemaVersion: 1,
    generatedAt: report.generatedAt,
    session: {
      sessionID: report.sessionID,
      models: report.models.map((m) => ({
        providerID: m.providerID,
        modelID: m.modelID,
        messageCount: m.messageCount,
        input: m.input,
        output: m.output,
        reasoning: m.reasoning,
        cacheRead: m.cacheRead,
        cacheWrite: m.cacheWrite,
      })),
    },
    quota: report.quota
      ? {
          status: report.quota.status,
          source: report.quota.source,
          fetchedAt: report.quota.fetchedAt,
          planType: report.quota.planType,
          fiveHour: report.quota.fiveHour,
          weekly: report.quota.weekly,
          unknownWindows: report.quota.unknownWindows,
          credits: report.quota.credits,
          warningCode: report.quota.warningCode,
        }
      : null,
    isWarning: report.isWarning,
  };
}

/**
 * Serialize a report to a JSON string.
 */
export function formatJson(report: Report): string {
  return JSON.stringify(toJsonReport(report), null, 2);
}
