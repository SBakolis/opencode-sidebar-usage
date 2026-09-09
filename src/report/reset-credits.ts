import type { ResetCredit, ResetCreditsInfo } from "../quota/types";

function resetTitle(credit: ResetCredit): string {
  if (credit.resetType === "codex_rate_limits") return "Full reset (Weekly + 5 hr)";
  return credit.title ?? "Usage limit reset";
}

/** Shared sidebar/tool output. Dates use the user's local time zone. */
export function formatResetCredits(info: ResetCreditsInfo | null, stale = false): string[] {
  if (info === null) return ["Unavailable"];

  const lines = [
    `${info.availableCount === 0 ? "No resets available" : `${info.availableCount} available`}${stale ? " (stale)" : ""}`,
  ];
  if (info.availableCount === 0) return lines;
  if (info.credits === null || info.credits.length === 0) {
    lines.push("Details unavailable");
    return lines;
  }

  for (const credit of info.credits) {
    const expiry =
      credit.expiresAt === null
        ? "No expiration"
        : `Expires ${new Date(credit.expiresAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}`;
    lines.push("", resetTitle(credit), expiry);
  }
  if (info.availableCount > info.credits.length) {
    lines.push("", "More reset details unavailable");
  }
  return lines;
}
