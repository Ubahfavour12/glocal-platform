/**
 * Instagram-direct OAuth (Instagram API with Instagram Login).
 * For businesses whose Instagram is NOT linked to a Facebook Page: they log in
 * with Instagram itself and grant content-publishing directly, no Page needed.
 * This is a SEPARATE flow from meta.ts (which reaches Instagram via a linked
 * Page). The "Connect Instagram" button uses this; "Connect Facebook" uses meta.
 *
 * Endpoints differ from the Graph/Facebook ones: authorize on instagram.com,
 * token exchange on api.instagram.com (form POST), long-lived + profile on
 * graph.instagram.com. Pure helpers are fixture-tested; routes wrap them.
 * Gated on the Instagram app being configured + App Review, same as Meta.
 */

import { fetchWithTimeout } from "@/lib/net/fetch";
const AUTHORIZE = "https://www.instagram.com/oauth/authorize";
const TOKEN = "https://api.instagram.com/oauth/access_token";
const GRAPH = "https://graph.instagram.com";

/** Permissions to read the account and publish content to it. */
export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export function instagramOAuthConfigFromEnv(origin: string): InstagramOAuthConfig {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) throw new Error("INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET not configured");
  return { appId, appSecret, redirectUri: `${origin}/api/oauth/instagram/callback` };
}

/** Pure: the Instagram consent screen URL (instagram.com, not facebook.com). */
export function buildInstagramAuthorizeUrl(cfg: InstagramOAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_SCOPES.join(","));
  url.searchParams.set("state", state);
  return url.toString();
}

export interface ShortTokenResult {
  accessToken: string;
  userId: string;
}

/** Pure: read the short-lived token response (has user_id, unlike Graph). */
export function parseShortToken(raw: {
  access_token?: string;
  user_id?: number | string;
  error_message?: string;
  error_type?: string;
}): ShortTokenResult {
  if (raw.error_message) throw new Error(`Instagram OAuth: ${raw.error_message}`);
  if (!raw.access_token) throw new Error("Instagram OAuth: no access_token returned");
  return { accessToken: raw.access_token, userId: raw.user_id != null ? String(raw.user_id) : "" };
}

export interface LongTokenResult {
  accessToken: string;
  expiresInSeconds: number | null;
}

/** Pure: read the long-lived exchange response. */
export function parseLongToken(raw: {
  access_token?: string;
  expires_in?: number;
  error?: { message?: string };
}): LongTokenResult {
  if (raw.error) throw new Error(`Instagram OAuth: ${raw.error.message ?? "token error"}`);
  if (!raw.access_token) throw new Error("Instagram OAuth: no long-lived access_token returned");
  return {
    accessToken: raw.access_token,
    expiresInSeconds: typeof raw.expires_in === "number" ? raw.expires_in : null,
  };
}

/** Long-lived Instagram tokens last ~60 days; compute the concrete expiry. */
export function tokenExpiry(expiresInSeconds: number | null, now: Date): Date | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null;
  return new Date(now.getTime() + expiresInSeconds * 1000);
}

// ---------- live calls (thin) ----------

export async function exchangeInstagramCode(
  cfg: InstagramOAuthConfig,
  code: string,
): Promise<ShortTokenResult> {
  const body = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
    code,
  });
  const res = await fetchWithTimeout(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseShortToken(await res.json());
}

export async function exchangeInstagramLongLived(
  cfg: InstagramOAuthConfig,
  shortToken: string,
): Promise<LongTokenResult> {
  const url = new URL(`${GRAPH}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("access_token", shortToken);
  const res = await fetchWithTimeout(url);
  return parseLongToken(await res.json());
}

export async function fetchInstagramProfile(
  token: string,
): Promise<{ id: string; username: string }> {
  const url = new URL(`${GRAPH}/me`);
  url.searchParams.set("fields", "id,username");
  url.searchParams.set("access_token", token);
  const res = await fetchWithTimeout(url);
  const data = (await res.json()) as { id?: string; username?: string };
  return { id: data.id ?? "", username: data.username ?? "" };
}
