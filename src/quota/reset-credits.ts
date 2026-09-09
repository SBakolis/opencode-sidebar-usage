import { z } from "zod";
import { redact } from "../redact";
import type { ResetCredit, ResetCreditsInfo } from "./types";

const SummarySchema = z.object({ available_count: z.number().int().nonnegative() });
const DetailsSchema = SummarySchema.extend({ credits: z.array(z.unknown()) });
const CreditSchema = z.object({
  reset_type: z.string().min(1),
  status: z.string(),
  is_supported_by_plan: z.boolean().optional(),
  title: z.string().nullable().catch(null),
  expires_at: z.string().datetime({ offset: true }).nullable(),
});

/** Reset metadata is optional: schema drift must not invalidate normal quota data. */
export function parseResetCreditsSummary(raw: unknown): ResetCreditsInfo | null {
  const parsed = SummarySchema.safeParse(raw);
  if (!parsed.success) return null;
  const availableCount = parsed.data.available_count;
  return { availableCount, credits: availableCount === 0 ? [] : null };
}

export function parseResetCreditsDetails(raw: unknown, nowMs: number): ResetCreditsInfo | null {
  const parsed = DetailsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const credits: ResetCredit[] = [];
  for (const item of parsed.data.credits) {
    const credit = CreditSchema.safeParse(item);
    if (!credit.success) continue;
    const data = credit.data;
    if (data.status !== "available" || data.is_supported_by_plan === false) continue;
    if (data.expires_at !== null && Date.parse(data.expires_at) <= nowMs) continue;
    credits.push({
      resetType: data.reset_type,
      title: data.title === null ? null : redact(data.title).replace(/\s+/g, " ").trim() || null,
      expiresAt: data.expires_at === null ? null : new Date(data.expires_at).toISOString(),
    });
  }

  credits.sort(
    (a, b) =>
      (a.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.expiresAt)) -
      (b.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.expiresAt)),
  );

  return {
    availableCount: parsed.data.available_count,
    credits: parsed.data.available_count === 0 ? [] : credits,
  };
}
