/**
 * Meta OAuth for self-serve social connect (Phase 3 foundation).
 * The customer clicks "Connect Facebook/Instagram", authorizes our app on
 * Meta's own site, and we receive a code -> exchange for a long-lived PAGE
 * token we store (never their password). Same redirect->code->token shape as
 * our magic-link /auth/callback, pointed at Meta.
 *
 * Works in dev mode for tester accounts today; goes public when the app
 * clears Meta App Review (Advanced Access) — the same approval the paid ads
 * need at launch. Pure helpers here are fixture-tested; the routes wrap them.
 */

import { fetchWithTimeout } from "@/lib/net/fetch";
const GRAPH = "https://graph.facebook.com/v21.0";
const DIALOG = "https://www.facebook.com/v21.0/dialog/oauth";

/** Permissions to post organically to the customer's own Page + Instagram. */
export const META_SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
];

export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export function metaOAuthConfigFromEnv(origin: string): MetaOAuthConfig {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("META_APP_ID / META_APP_SECRET not configured");
  return { appId, appSecret, redirectUri: `${origin}/api/oauth/meta/callback` };
}

/** Pure: the Meta consent dialog URL the customer is sent to. */
export function buildAuthorizeUrl(cfg: MetaOAuthConfig, state: string): string {
  const url = new URL(DIALOG);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export interface TokenResult {
  accessToken: string;
  expiresInSeconds: number | null;
}

/** Pure: read a Graph token response defensively. */
export function parseTokenResponse(raw: {
  access_token?: string;
  expires_in?: number;
  error?: { message?: string };
}): TokenResult {
  if (raw.error) throw new Error(`Meta OAuth: ${raw.error.message ?? "token error"}`);
  if (!raw.access_token) throw new Error("Meta OAuth: no access_token returned");
  return {
    accessToken: raw.access_token,
    expiresInSeconds: typeof raw.expires_in === "number" ? raw.expires_in : null,
  };
}

export interface ConnectedPage {
  pageId: string;
  name: string;
  pageAccessToken: string;
  instagramId: string | null;
}

/** Pure: flatten /me/accounts into the pages (+ linked IG) we can post to. */
export function parsePages(raw: {
  data?: {
    id?: string;
    name?: string;
    access_token?: string;
    instagram_business_account?: { id?: string };
  }[];
}): ConnectedPage[] {
  return (raw.data ?? [])
    .filter((p) => p.id && p.access_token)
    .map((p) => ({
      pageId: p.id!,
      name: p.name ?? "Page",
      pageAccessToken: p.access_token!,
      instagramId: p.instagram_business_account?.id ?? null,
    }));
}

/** Long-lived tokens last ~60 days; compute the concrete expiry. */
export function tokenExpiry(expiresInSeconds: number | null, now: Date): Date | null {
  if (!expiresInSeconds || expiresInSeconds <= 0) return null;
  return new Date(now.getTime() + expiresInSeconds * 1000);
}

// ---------- live Graph calls (thin) ----------

export async function exchangeCodeForToken(
  cfg: MetaOAuthConfig,
  code: string,
): Promise<TokenResult> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("code", code);
  const res = await fetchWithTimeout(url);
  return parseTokenResponse(await res.json());
}

export async function exchangeForLongLivedToken(
  cfg: MetaOAuthConfig,
  shortToken: string,
): Promise<TokenResult> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);
  const res = await fetchWithTimeout(url);
  return parseTokenResponse(await res.json());
}

export async function fetchPages(userToken: string): Promise<ConnectedPage[]> {
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account");
  url.searchParams.set("access_token", userToken);
  const res = await fetchWithTimeout(url);
  return parsePages(await res.json());
}
