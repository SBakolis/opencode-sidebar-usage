/**
 * Controlled error types for opencode-codex-meter.
 *
 * All errors are sanitized: they never carry access tokens, refresh
 * tokens, raw JWTs, account IDs, or complete auth payloads. Errors
 * that originate from network or auth operations carry only a
 * human-readable message and a stable warning code.
 */

/**
 * Base class for all plugin errors. Carries a stable `code` for
 * programmatic handling and a sanitized `message` safe for logs,
 * toasts, and user-facing CLI output.
 */
export class CodexMeterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CodexMeterError";
    this.code = code;
  }
}

/**
 * Raised when a token value cannot be safely normalized.
 *
 * Causes:
 * - Infinity or -Infinity in a token field.
 * - A token total that would exceed Number.MAX_SAFE_INTEGER.
 *
 * NaN, negative, fractional, and non-numeric values are silently
 * normalized to zero and do NOT raise this error. Only values that
 * would corrupt precision or represent genuine overflow trigger it.
 */
export class TokenOverflowError extends CodexMeterError {
  readonly field: string;
  readonly value: number;

  constructor(field: string, value: number) {
    super(
      "TOKEN_OVERFLOW",
      `Token field "${field}" has value ${value} which exceeds safe integer bounds or is infinite.`,
    );
    this.name = "TokenOverflowError";
    this.field = field;
    this.value = value;
  }
}

/**
 * Raised when the session store receives a snapshot with empty or
 * invalid identifying fields (sessionID, messageID, providerID, modelID).
 */
export class InvalidSnapshotError extends CodexMeterError {
  readonly field: string;

  constructor(field: string, message: string) {
    super("INVALID_SNAPSHOT", message);
    this.name = "InvalidSnapshotError";
    this.field = field;
  }
}
