/**
 * Centralized redaction helper.
 *
 * Sanitizes strings that may contain access tokens, refresh tokens,
 * JWT-like strings, auth headers, account IDs, or nested error causes.
 * Used by every log and error path to prevent credential leakage.
 */

/**
 * Patterns that match known secret formats.
 * Each pattern is replaced with a type indicator.
 */
const REDACTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  // JWT-like strings (eyJ... followed by base64)
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacement: "[REDACTED_JWT]",
  },
  // Bearer tokens in Authorization headers
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, replacement: "Bearer [REDACTED]" },
  // Refresh tokens (rt_ prefix)
  { pattern: /\brt_[A-Za-z0-9_-]{8,}\b/g, replacement: "[REDACTED_REFRESH]" },
  // Account IDs (acct_ prefix)
  { pattern: /\bacct_[A-Za-z0-9_-]{6,}\b/g, replacement: "[REDACTED_ACCOUNT]" },
  // OpenAI API keys (sk- prefix, 20+ chars)
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED_API_KEY]" },
  // Generic long hex/base64 strings that look like tokens (40+ chars)
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replacement: "[REDACTED_TOKEN]" },
];

/**
 * Redact known secret patterns from a string.
 * Returns a new string with secrets replaced by type indicators.
 */
export function redact(input: string): string {
  let result = input;
  for (const { pattern, replacement } of REDACTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Redact secrets from an unknown value. Recursively processes objects,
 * arrays, and nested error causes. Returns a sanitized deep copy.
 */
export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return redact(value);
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // Never copy known secret field names, even if the value is not a string.
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === "access" ||
        lowerKey === "accesstoken" ||
        lowerKey === "refresh" ||
        lowerKey === "refreshtoken" ||
        lowerKey === "authorization" ||
        lowerKey === "accountid" ||
        lowerKey === "key" ||
        lowerKey === "token"
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = redactDeep(val);
      }
    }
    // Handle Error objects with cause chains.
    if (value instanceof Error) {
      result.message = redact(value.message);
      result.name = value.name;
      if (value.cause) {
        result.cause = redactDeep(value.cause);
      }
    }
    return result;
  }
  return value;
}

/**
 * Sanitize an error for logging or returning to users.
 * Extracts message and code, redacts any secrets.
 */
export function sanitizeError(err: unknown): { message: string; name: string; code?: string } {
  if (err instanceof Error) {
    return {
      message: redact(err.message),
      name: err.name,
      code: (err as { code?: string }).code,
    };
  }
  if (typeof err === "string") {
    return { message: redact(err), name: "Error" };
  }
  return { message: "unknown error", name: "Error" };
}
