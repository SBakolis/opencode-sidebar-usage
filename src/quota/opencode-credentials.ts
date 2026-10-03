import type { Credential } from "@opencode/plugin";
import type { Plugin } from "@opencode/plugin";
import type { Credentials } from "./auth-reader";

export type OpenCodeConnectionSource = Pick<
  Plugin.Context["integration"]["connection"],
  "active" | "resolve"
>;

function unavailable(status: Exclude<Credentials["status"], "ok">): Credentials {
  return {
    status,
    accessToken: null,
    expires: null,
    accountId: null,
    warningCode: status === "unavailable" ? "UNAVAILABLE" : "AUTH_REQUIRED",
    source: "opencode",
  };
}

export function credentialsFromOpenCode(
  value: Credential.Value | undefined,
  now: number,
): Credentials {
  if (!value) return unavailable("unauthenticated");
  if (value.type !== "oauth") return unavailable("unsupported");
  if (value.access.length === 0 || !Number.isFinite(value.expires)) {
    return unavailable("malformed");
  }
  if (value.expires <= now + 5 * 60 * 1000) return unavailable("expired");

  const accountID = value.metadata?.accountID;
  const accountId = typeof accountID === "string" && accountID.length > 0 ? accountID : null;
  if (!accountId) {
    return {
      ...unavailable("missing-account-id"),
      accessToken: value.access,
      expires: value.expires,
    };
  }

  return {
    status: "ok",
    accessToken: value.access,
    expires: value.expires,
    accountId,
    warningCode: null,
    source: "opencode",
  };
}

export async function readOpenCodeCredentials(
  connections: OpenCodeConnectionSource,
  now: number,
): Promise<Credentials> {
  try {
    const connection = await connections.active("openai");
    if (!connection) return unavailable("unauthenticated");
    return credentialsFromOpenCode(await connections.resolve(connection), now);
  } catch {
    return unavailable("unavailable");
  }
}
