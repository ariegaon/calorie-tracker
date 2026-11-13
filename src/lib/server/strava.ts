// Server-only: Strava configuration, token storage and token refresh.

import { decryptJson, encryptJson } from "@/lib/server/crypto";
import { selectRows, updateRows, type Access } from "@/lib/server/supabase";

export const STRAVA_SCOPE = "activity:read_all";

export type StravaConfig = { clientId: string; clientSecret: string };

export function stravaConfig(): StravaConfig | null {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export type StravaTokens = { access: string; refresh: string; expiresAt: number };

export function encryptTokens(tokens: StravaTokens, config: StravaConfig): string {
  return encryptJson(tokens, config.clientSecret);
}

function isTokens(value: unknown): value is StravaTokens {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.access === "string" && typeof record.refresh === "string" && typeof record.expiresAt === "number";
}

/** Reads the token fields of a Strava token response. Null when the response is not a token response. */
export function tokensFromResponse(body: unknown): StravaTokens | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (typeof record.access_token !== "string" || typeof record.refresh_token !== "string" || typeof record.expires_at !== "number") {
    return null;
  }
  return { access: record.access_token, refresh: record.refresh_token, expiresAt: record.expires_at };
}

export async function requestTokens(config: StravaConfig, grant: Record<string, string>): Promise<Response> {
  return fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...grant }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
}

export type IntegrationRow = { id: string; encrypted_tokens: string; last_synced_at: string | null; status: string };

export async function loadIntegration(access: Access): Promise<IntegrationRow | null> {
  const rows = await selectRows<IntegrationRow>(
    access,
    "user_integrations",
    "provider=eq.strava&select=id,encrypted_tokens,last_synced_at,status&limit=1",
  );
  return rows[0] ?? null;
}

export type TokenResult = { ok: true; accessToken: string } | { ok: false; reason: "needs_reconnect" | "unavailable" };

/** A valid access token for the caller's Strava connection, refreshing and re-storing it when it is about to expire. */
export async function validAccessToken(access: Access, config: StravaConfig, row: IntegrationRow): Promise<TokenResult> {
  const stored = decryptJson(row.encrypted_tokens, config.clientSecret);
  if (!isTokens(stored)) return { ok: false, reason: "needs_reconnect" };
  if (stored.expiresAt - Date.now() / 1000 > 300) return { ok: true, accessToken: stored.access };

  let response: Response;
  try {
    response = await requestTokens(config, { grant_type: "refresh_token", refresh_token: stored.refresh });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (response.status === 400 || response.status === 401) {
    await updateRows(access, "user_integrations", `id=eq.${row.id}`, { status: "needs_reconnect" });
    return { ok: false, reason: "needs_reconnect" };
  }
  if (!response.ok) return { ok: false, reason: "unavailable" };

  const tokens = tokensFromResponse(await response.json().catch(() => null));
  if (!tokens) return { ok: false, reason: "unavailable" };
  await updateRows(access, "user_integrations", `id=eq.${row.id}`, {
    encrypted_tokens: encryptTokens(tokens, config),
    status: "connected",
  });
  return { ok: true, accessToken: tokens.access };
}
