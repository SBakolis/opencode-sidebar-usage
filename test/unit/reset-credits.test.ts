import { describe, expect, it } from "vitest";
import { parseResetCreditsDetails, parseResetCreditsSummary } from "../../src/quota/reset-credits";
import { parseWhamResponse } from "../../src/quota/schemas";
import { formatResetCredits } from "../../src/report/reset-credits";

const NOW = Date.parse("2026-09-09T00:00:00Z");
// Synthetic values with the field shape verified against the live endpoint.
const credit = {
  id: "private-reset-id",
  reset_type: "codex_rate_limits",
  is_supported_by_plan: true,
  status: "available",
  granted_at: "2026-09-04T03:00:00.123456Z",
  expires_at: "2026-10-04T03:00:00.123456Z",
  title: "Full reset",
  description: "A complimentary reset",
  profile_user_id: "private-profile-id",
};

describe("reset credit parsing", () => {
  it("distinguishes unavailable counts, zero resets, and count-only data", () => {
    expect(parseResetCreditsSummary(undefined)).toBeNull();
    expect(parseResetCreditsSummary(null)).toBeNull();
    expect(parseResetCreditsSummary({ available_count: 0 })).toEqual({
      availableCount: 0,
      credits: [],
    });
    expect(parseResetCreditsSummary({ available_count: 2 })).toEqual({
      availableCount: 2,
      credits: null,
    });
  });

  it.each([-1, 1.5, "2", null, Number.NaN, Number.POSITIVE_INFINITY])(
    "ignores malformed reset count %s without losing quota",
    (available_count) => {
      const parsed = parseWhamResponse({
        windows: [{ window_seconds: 18000, used_percent: 20 }],
        rate_limit_reset_credits: { available_count },
      });
      expect(parsed.ok).toBe(true);
      expect(parsed.windows[0]?.usedPercent).toBe(20);
      expect(parsed.resetCredits).toBeNull();
    },
  );

  it("reads live-shaped data, sorts expiry dates, and retains only display fields", () => {
    const result = parseResetCreditsDetails(
      {
        available_count: 4,
        credits: [
          { ...credit, expires_at: null },
          { ...credit, expires_at: "2026-10-05T03:00:00Z" },
          credit,
        ],
        total_earned_count: 8,
      },
      NOW,
    );
    expect(result?.availableCount).toBe(4);
    expect(result?.credits).toEqual([
      {
        resetType: "codex_rate_limits",
        title: "Full reset",
        expiresAt: "2026-10-04T03:00:00.123Z",
      },
      {
        resetType: "codex_rate_limits",
        title: "Full reset",
        expiresAt: "2026-10-05T03:00:00.000Z",
      },
      { resetType: "codex_rate_limits", title: "Full reset", expiresAt: null },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(JSON.stringify(result)).not.toContain("description");
  });

  it("skips redeemed, expired, unsupported, and malformed details without inferring a count", () => {
    const result = parseResetCreditsDetails(
      {
        available_count: 2,
        credits: [
          credit,
          { ...credit, status: "redeemed" },
          { ...credit, status: "expired" },
          { ...credit, expires_at: new Date(NOW).toISOString() },
          { ...credit, is_supported_by_plan: false },
          { ...credit, expires_at: "bad-date" },
          { ...credit, expires_at: undefined },
          null,
        ],
      },
      NOW,
    );
    expect(result?.availableCount).toBe(2);
    expect(result?.credits).toHaveLength(1);
  });

  it("tolerates missing titles and plan flags, sanitizes titles, and handles zero", () => {
    const result = parseResetCreditsDetails(
      {
        available_count: 2,
        credits: [
          { ...credit, title: undefined, is_supported_by_plan: undefined },
          { ...credit, title: "  Reset\nBearer ey_fake_access  " },
        ],
      },
      NOW,
    );
    expect(result?.credits?.[0]?.title).toBeNull();
    expect(result?.credits?.[1]?.title).not.toContain("ey_fake_access");
    expect(result?.credits?.[1]?.title).not.toContain("\n");
    expect(parseResetCreditsDetails({ available_count: 0, credits: [credit] }, NOW)).toEqual({
      availableCount: 0,
      credits: [],
    });
  });

  it.each([null, [], {}, { available_count: 2 }, { available_count: 2, credits: {} }])(
    "rejects malformed detail responses",
    (raw) => expect(parseResetCreditsDetails(raw, NOW)).toBeNull(),
  );
});

describe("sidebar and report reset display", () => {
  it("shows the count, full reset scope, and expiry in local time", () => {
    const parsed = parseResetCreditsDetails({ available_count: 1, credits: [credit] }, NOW);
    const lines = formatResetCredits(parsed);
    expect(lines).toContain("1 available");
    expect(lines).toContain("Full reset (Weekly + 5 hr)");
    expect(lines).toContain(
      `Expires ${new Date(credit.expires_at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`,
    );
  });

  it("keeps unavailable, zero, and count-only states distinct", () => {
    expect(formatResetCredits(null)).toEqual(["Unavailable"]);
    expect(formatResetCredits({ availableCount: 0, credits: [] })).toEqual(["No resets available"]);
    expect(formatResetCredits({ availableCount: 2, credits: null })).toEqual([
      "2 available",
      "Details unavailable",
    ]);
    expect(formatResetCredits({ availableCount: 2, credits: [] })).toEqual([
      "2 available",
      "Details unavailable",
    ]);
  });

  it("labels stale and partial lists, unknown reset types, and no expiration", () => {
    const lines = formatResetCredits(
      {
        availableCount: 3,
        credits: [
          { resetType: "future_type", title: "Special reset", expiresAt: null },
          { resetType: "future_type", title: null, expiresAt: null },
        ],
      },
      true,
    );
    expect(lines).toContain("3 available (stale)");
    expect(lines).toContain("Special reset");
    expect(lines).toContain("Usage limit reset");
    expect(lines).toContain("No expiration");
    expect(lines).toContain("More reset details unavailable");
    expect(lines).not.toContain("Full reset (Weekly + 5 hr)");
  });
});
