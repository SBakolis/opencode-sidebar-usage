/**
 * Runtime validation for the wham endpoint response.
 *
 * The wham endpoint (`https://chatgpt.com/backend-api/wham/usage`) is
 * unsupported and undocumented. Its response shape may change without
 * notice. This module uses a tolerant Zod schema that:
 *
 * - Accepts additive unknown fields (`.passthrough()`).
 * - Tries multiple field name variants for each property.
 * - Never throws on schema drift; returns a structured result instead.
 *
 * Window identification is by DURATION, not by response position or name.
 */

import { z } from "zod";
import type { CreditsInfo, UsageWindow } from "./types";
import { identifyWindow } from "./types";

/**
 * Flexible schema for a single window object in the wham response.
 * Tries multiple field name variants for each property.
 */
const WindowSchema = z
  .object({
    // Duration in seconds (preferred)
    window_seconds: z.number().optional(),
    windowSeconds: z.number().optional(),
    duration_seconds: z.number().optional(),
    durationSeconds: z.number().optional(),
    limit_window_seconds: z.number().optional(),
    limitWindowSeconds: z.number().optional(),
    // Duration in minutes (converted to seconds)
    window_minutes: z.number().optional(),
    windowMinutes: z.number().optional(),
    duration_minutes: z.number().optional(),
    durationMinutes: z.number().optional(),
    // Used percentage
    used_percent: z.number().optional(),
    usedPercent: z.number().optional(),
    percent: z.number().optional(),
    usage_percent: z.number().optional(),
    // Reset time — may be an ISO string OR a Unix timestamp (number, seconds)
    resets_at: z.union([z.string(), z.number()]).optional(),
    resetsAt: z.union([z.string(), z.number()]).optional(),
    reset_at: z.union([z.string(), z.number()]).optional(),
    resetAt: z.union([z.string(), z.number()]).optional(),
    // Reset after (seconds)
    reset_after_seconds: z.number().optional(),
    resetAfterSeconds: z.number().optional(),
    seconds_until_reset: z.number().optional(),
    secondsUntilReset: z.number().optional(),
  })
  .passthrough();

/**
 * Flexible schema for the credits object.
 */
const CreditsSchema = z
  .object({
    has_credits: z.boolean().optional(),
    hasCredits: z.boolean().optional(),
    unlimited: z.boolean().optional(),
    balance: z.union([z.string(), z.number()]).optional(),
    remaining: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

/**
 * Flexible schema for the top-level wham response.
 */
const WhamResponseSchema = z
  .object({
    // Windows array — try multiple keys
    windows: z.array(WindowSchema).optional(),
    usage_windows: z.array(WindowSchema).optional(),
    usageWindows: z.array(WindowSchema).optional(),
    rate_limits: z.array(WindowSchema).optional(),
    rateLimits: z.array(WindowSchema).optional(),
    limits: z.array(WindowSchema).optional(),
    // rate_limit object with primary_window / secondary_window (singular)
    rate_limit: z
      .object({
        primary_window: WindowSchema.nullable().optional(),
        primaryWindow: WindowSchema.nullable().optional(),
        secondary_window: WindowSchema.nullable().optional(),
        secondaryWindow: WindowSchema.nullable().optional(),
      })
      .passthrough()
      .optional(),
    // Plan type
    plan_type: z.string().optional(),
    planType: z.string().optional(),
    plan: z.string().optional(),
    subscription: z.string().optional(),
    // Credits
    credits: CreditsSchema.optional(),
    extra_usage: CreditsSchema.optional(),
    extraUsage: CreditsSchema.optional(),
  })
  .passthrough();

/**
 * Result of parsing a wham response.
 */
export interface WhamParseResult {
  readonly ok: boolean;
  readonly windows: UsageWindow[];
  readonly planType: string | null;
  readonly credits: CreditsInfo | null;
}

/**
 * Extract duration in seconds from a window object, trying multiple
 * field names and converting minutes to seconds.
 */
function extractDurationSeconds(w: z.infer<typeof WindowSchema>): number | null {
  // Direct seconds fields
  const secs =
    w.window_seconds ??
    w.windowSeconds ??
    w.duration_seconds ??
    w.durationSeconds ??
    w.limit_window_seconds ??
    w.limitWindowSeconds;
  if (typeof secs === "number" && secs > 0) return secs;

  // Minutes fields — convert to seconds
  const mins = w.window_minutes ?? w.windowMinutes ?? w.duration_minutes ?? w.durationMinutes;
  if (typeof mins === "number" && mins > 0) return mins * 60;

  return null;
}

/**
 * Extract used percentage from a window object.
 */
function extractUsedPercent(w: z.infer<typeof WindowSchema>): number {
  const pct = w.used_percent ?? w.usedPercent ?? w.percent ?? w.usage_percent;
  if (typeof pct === "number" && Number.isFinite(pct)) {
    return Math.max(0, pct);
  }
  return 0;
}

/**
 * Extract reset time from a window object.
 * Accepts either an ISO string or a Unix timestamp (number, in seconds).
 * Returns an ISO string or null.
 */
function extractResetsAt(w: z.infer<typeof WindowSchema>): string | null {
  const val = w.resets_at ?? w.resetsAt ?? w.reset_at ?? w.resetAt;
  if (typeof val === "string" && val.length > 0) {
    return val;
  }
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    // Unix timestamp in seconds → ISO string
    return new Date(val * 1000).toISOString();
  }
  return null;
}

/**
 * Extract reset-after seconds from a window object.
 */
function extractResetAfterSeconds(w: z.infer<typeof WindowSchema>): number | null {
  const val =
    w.reset_after_seconds ?? w.resetAfterSeconds ?? w.seconds_until_reset ?? w.secondsUntilReset;
  if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
    return val;
  }
  return null;
}

/**
 * Parse a raw wham response into normalized windows, plan type, and credits.
 *
 * Returns `{ ok: false, windows: [], ... }` on schema drift or parse failure.
 * Returns `{ ok: true, windows: [...], ... }` on success, even if some
 * windows are "unknown" duration.
 */
export function parseWhamResponse(raw: unknown): WhamParseResult {
  // Try to parse as a top-level array of windows first.
  if (Array.isArray(raw)) {
    const arrayResult = parseWindowsArray(raw);
    return {
      ok: true,
      windows: arrayResult,
      planType: null,
      credits: null,
    };
  }

  // Otherwise parse as an object.
  const parsed = WhamResponseSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, windows: [], planType: null, credits: null };
  }

  const data = parsed.data;

  // Find the windows array.
  const rawWindows =
    data.windows ??
    data.usage_windows ??
    data.usageWindows ??
    data.rate_limits ??
    data.rateLimits ??
    data.limits ??
    [];

  const windows = parseWindowsArray(rawWindows);

  // Also extract windows from rate_limit.primary_window / secondary_window
  // (singular objects, not arrays). The real wham endpoint uses this shape.
  const rateLimit = data.rate_limit;
  if (rateLimit) {
    const primary = rateLimit.primary_window ?? rateLimit.primaryWindow;
    if (primary) {
      const parsedPrimary = parseSingleWindow(primary);
      if (parsedPrimary) windows.push(parsedPrimary);
    }
    const secondary = rateLimit.secondary_window ?? rateLimit.secondaryWindow;
    if (secondary) {
      const parsedSecondary = parseSingleWindow(secondary);
      if (parsedSecondary) windows.push(parsedSecondary);
    }
  }

  // Extract plan type.
  const planType = data.plan_type ?? data.planType ?? data.plan ?? data.subscription ?? null;
  const normalizedPlanType = typeof planType === "string" ? planType : null;

  // Extract credits.
  const rawCredits = data.credits ?? data.extra_usage ?? data.extraUsage;
  const credits = parseCredits(rawCredits);

  return {
    ok: true,
    windows,
    planType: normalizedPlanType,
    credits,
  };
}

/**
 * Parse a single raw window object into a normalized UsageWindow.
 * Returns null if the window fails schema validation.
 */
function parseSingleWindow(item: unknown): UsageWindow | null {
  if (item === null || item === undefined) return null;
  const parsed = WindowSchema.safeParse(item);
  if (!parsed.success) return null;
  return windowFromParsed(parsed.data);
}

/**
 * Parse an array of raw window objects into normalized UsageWindow[].
 */
function parseWindowsArray(arr: unknown[]): UsageWindow[] {
  const result: UsageWindow[] = [];
  for (const item of arr) {
    const parsed = WindowSchema.safeParse(item);
    if (!parsed.success) continue;
    const w = windowFromParsed(parsed.data);
    if (w) result.push(w);
  }
  return result;
}

/**
 * Build a UsageWindow from a successfully-parsed window object.
 * Returns null only if the window fails internal validation (shouldn't
 * happen after a successful Zod parse, but defensive).
 */
function windowFromParsed(data: z.infer<typeof WindowSchema>): UsageWindow | null {
  const durationSeconds = extractDurationSeconds(data);
  if (durationSeconds === null) {
    // Window without duration info — classify as unknown.
    return {
      kind: "unknown",
      usedPercent: extractUsedPercent(data),
      windowSeconds: 0,
      resetsAt: extractResetsAt(data),
      resetAfterSeconds: extractResetAfterSeconds(data),
    };
  }

  return {
    kind: identifyWindow(durationSeconds),
    usedPercent: extractUsedPercent(data),
    windowSeconds: durationSeconds,
    resetsAt: extractResetsAt(data),
    resetAfterSeconds: extractResetAfterSeconds(data),
  };
}

/**
 * Parse the credits object into normalized CreditsInfo.
 */
function parseCredits(raw: unknown): CreditsInfo | null {
  if (raw === null || raw === undefined) return null;

  const parsed = CreditsSchema.safeParse(raw);
  if (!parsed.success) return null;

  const data = parsed.data;
  const hasCredits = data.has_credits ?? data.hasCredits ?? true;
  const unlimited = data.unlimited ?? false;

  let balance: string | null = null;
  const rawBalance = data.balance ?? data.remaining;
  if (typeof rawBalance === "number") {
    balance = String(rawBalance);
  } else if (typeof rawBalance === "string") {
    balance = rawBalance;
  }

  return { hasCredits, unlimited, balance };
}
