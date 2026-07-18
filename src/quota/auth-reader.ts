/**
 * Secure credential discovery for the OpenAI/Codex OAuth entry.
 *
 * Reads ONLY the access token, expiry, and account ID from the OpenAI
 * entry in `auth.json`. Never returns, retains, or logs the refresh
 * token. Never writes to `auth.json`. Never refreshes the token.
 *
 * Credential resolution order:
 * 1. OPENCODE_AUTH_CONTENT (unverified, defensive parse)
 * 2. CODEX_METER_AUTH_PATH (plugin-specific override)
 * 3. $XDG_DATA_HOME/opencode/auth.json
 * 4. $HOME/.local/share/opencode/auth.json
 *
 * All filesystem, environment, and clock access is injectable for testing.
 */

/**
 * Internal credential object. The smallest possible representation.
 * `refresh` is intentionally absent — this module never exposes it.
 */
export interface Credentials {
  readonly status:
    | "ok"
    | "unauthenticated"
    | "expired"
    | "missing-account-id"
    | "malformed"
    | "unsupported";
  readonly accessToken: string | null;
  readonly expires: number | null;
  readonly accountId: string | null;
  readonly warningCode: string | null;
  readonly source: "env" | "env-path" | "xdg" | "default" | "none";
}

/** A "no credentials" result for when discovery fails entirely. */
export const NO_CREDENTIALS: Credentials = {
  status: "unauthenticated",
  accessToken: null,
  expires: null,
  accountId: null,
  warningCode: "AUTH_REQUIRED",
  source: "none",
};

// ── Injectable interfaces ─────────────────────────────────────────────

export interface EnvSource {
  get(key: string): string | undefined;
}

export interface FsSource {
  readFile(path: string): Promise<string | null>;
}

export interface HomeDirProvider {
  home(): string;
}

export interface Clock {
  now(): number;
}

// ── Runtime schema for auth.json ──────────────────────────────────────

/**
 * Parsed OpenAI OAuth entry. `refresh` is intentionally read and then
 * discarded — it is never returned to callers.
 */
interface OpenAIEntry {
  type?: string;
  access?: unknown;
  refresh?: unknown;
  expires?: unknown;
  accountId?: unknown;
}

interface AuthFile {
  [providerID: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────

// (safeType helper removed — debug logging is not used in v1; the
// logger receives only sanitized path/status messages.)

/**
 * Parse and validate the OpenAI OAuth entry from an auth file object.
 * Returns Credentials or a status-only result on failure.
 *
 * This function NEVER returns the refresh token, even if it exists in
 * the parsed entry.
 */
function extractCredentials(
  authFile: AuthFile,
  clock: Clock,
  source: Credentials["source"],
): Credentials {
  const entry = authFile.openai;
  if (entry === null || entry === undefined) {
    return {
      status: "unauthenticated",
      accessToken: null,
      expires: null,
      accountId: null,
      warningCode: "AUTH_REQUIRED",
      source,
    };
  }

  if (typeof entry !== "object" || Array.isArray(entry)) {
    return {
      status: "malformed",
      accessToken: null,
      expires: null,
      accountId: null,
      warningCode: "AUTH_REQUIRED",
      source,
    };
  }

  const oauth = entry as OpenAIEntry;

  // Must be OAuth type for Codex quota.
  if (oauth.type !== "oauth") {
    return {
      status: "unsupported",
      accessToken: null,
      expires: null,
      accountId: null,
      warningCode: "AUTH_REQUIRED",
      source,
    };
  }

  // Access token must be a non-empty string.
  if (typeof oauth.access !== "string" || oauth.access.length === 0) {
    return {
      status: "malformed",
      accessToken: null,
      expires: null,
      accountId: null,
      warningCode: "AUTH_REQUIRED",
      source,
    };
  }

  // Expires must be a finite number.
  const expires =
    typeof oauth.expires === "number" && Number.isFinite(oauth.expires) ? oauth.expires : null;

  if (expires === null) {
    return {
      status: "malformed",
      accessToken: null,
      expires: null,
      accountId: null,
      warningCode: "AUTH_REQUIRED",
      source,
    };
  }

  // Check expiry. 5-minute grace period to avoid race conditions.
  const now = clock.now();
  if (expires <= now + 5 * 60 * 1000) {
    return {
      status: "expired",
      accessToken: null,
      expires: null,
      accountId: null,
      warningCode: "AUTH_REQUIRED",
      source,
    };
  }

  // Account ID is optional but needed by the wham provider.
  const accountId =
    typeof oauth.accountId === "string" && oauth.accountId.length > 0 ? oauth.accountId : null;

  // If the wham provider needs accountId and it's missing, we still
  // return the credentials — the quota provider will handle the
  // missing-account-id case. But we flag it.
  if (accountId === null) {
    return {
      status: "missing-account-id",
      accessToken: oauth.access,
      expires,
      accountId: null,
      warningCode: "AUTH_REQUIRED",
      source,
    };
  }

  // Success. Note: refresh is intentionally NOT included.
  return {
    status: "ok",
    accessToken: oauth.access,
    expires,
    accountId,
    warningCode: null,
    source,
  };
}

// ── AuthReader ────────────────────────────────────────────────────────

/**
 * Reads OpenAI/Codex OAuth credentials from the verified resolution
 * chain. All I/O is injectable. Never writes, never refreshes.
 */
export class AuthReader {
  private readonly fs: FsSource;
  private readonly env: EnvSource;
  private readonly home: HomeDirProvider;
  private readonly clock: Clock;
  private readonly logger: (message: string) => void;

  constructor(
    fs: FsSource,
    env: EnvSource,
    home: HomeDirProvider,
    clock: Clock,
    logger?: (message: string) => void,
  ) {
    this.fs = fs;
    this.env = env;
    this.home = home;
    this.clock = clock;
    this.logger = logger ?? (() => {});
  }

  /**
   * Read credentials from the resolution chain. Returns a Credentials
   * object; never throws. On any error, returns a status indicating
   * why credentials are unavailable.
   *
   * The refresh token is NEVER present in the returned object.
   */
  async readCredentials(): Promise<Credentials> {
    // 1. OPENCODE_AUTH_CONTENT (unverified, defensive)
    const envContent = this.env.get("OPENCODE_AUTH_CONTENT");
    if (envContent !== undefined && envContent.length > 0) {
      const result = this.parseContent(envContent, "env");
      if (result !== null) return result;
      // Fall through to file-based resolution on parse failure.
    }

    // 2. CODEX_METER_AUTH_PATH
    const explicitPath = this.env.get("CODEX_METER_AUTH_PATH");
    if (explicitPath !== undefined && explicitPath.length > 0) {
      const result = await this.readFromFile(explicitPath, "env-path");
      if (result !== null) return result;
    }

    // 3. $XDG_DATA_HOME/opencode/auth.json
    const xdgData = this.env.get("XDG_DATA_HOME");
    if (xdgData !== undefined && xdgData.length > 0) {
      const xdgPath = `${xdgData}/opencode/auth.json`;
      const result = await this.readFromFile(xdgPath, "xdg");
      if (result !== null) return result;
    }

    // 4. $HOME/.local/share/opencode/auth.json
    const homeDir = this.home.home();
    if (homeDir.length > 0) {
      const defaultPath = `${homeDir}/.local/share/opencode/auth.json`;
      const result = await this.readFromFile(defaultPath, "default");
      if (result !== null) return result;
    }

    // No credentials found anywhere.
    this.logger("No OpenAI OAuth credentials found in any resolution path.");
    return NO_CREDENTIALS;
  }

  /**
   * Parse auth content from a string (env var or file).
   * Returns null on parse failure (caller falls through to next source).
   * Returns Credentials on successful parse (even if status is not "ok").
   */
  private parseContent(content: string, source: Credentials["source"]): Credentials | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      this.logger(`Failed to parse auth content from ${source}.`);
      return null;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      this.logger(`Auth content from ${source} is not a JSON object.`);
      return null;
    }

    return extractCredentials(parsed as AuthFile, this.clock, source);
  }

  /**
   * Read and parse auth from a file path.
   * Returns null if file doesn't exist or can't be read.
   * Returns Credentials on successful parse.
   */
  private async readFromFile(
    path: string,
    source: Credentials["source"],
  ): Promise<Credentials | null> {
    let content: string | null;
    try {
      content = await this.fs.readFile(path);
    } catch {
      this.logger(`Failed to read auth file at ${path}.`);
      return null;
    }

    if (content === null) {
      // File doesn't exist — fall through to next source.
      return null;
    }

    return this.parseContent(content, source);
  }
}
