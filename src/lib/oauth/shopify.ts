/**
 * Shopify store-connect OAuth (Phase 3). One-click connect: the customer
 * enters their shop, authorizes on Shopify's own admin, and we store an
 * access token to read their orders for true ROAS. Same redirect->code->token
 * shape as meta.ts; Shopify additionally HMAC-signs the callback.
 * Pure helpers (shop normalisation, authorize URL, HMAC message + verify) are
 * fixture-tested; live token exchange is thin.
 */

import { fetchWithTimeout } from "@/lib/net/fetch";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SHOPIFY_SCOPES = ["read_orders"];

export interface ShopifyOAuthConfig {
  apiKey: string;
  apiSecret: string;
  redirectUri: string;
}

export function shopifyConfigFromEnv(origin: string): ShopifyOAuthConfig {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error("SHOPIFY_API_KEY / SHOPIFY_API_SECRET not configured");
  return { apiKey, apiSecret, redirectUri: `${origin}/api/oauth/shopify/callback` };
}

/** Pure: normalise "mystore" or "mystore.myshopify.com" -> "mystore.myshopify.com"; reject junk. */
export function normalizeShopDomain(input: string): string {
  let s = (input ?? "").trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!s.includes(".")) s = `${s}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s)) {
    throw new Error("enter a valid myshopify.com store");
  }
  return s;
}

/** Pure: the Shopify admin consent URL. */
export function buildAuthorizeUrl(cfg: ShopifyOAuthConfig, shop: string, state: string): string {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", cfg.apiKey);
  url.searchParams.set("scope", SHOPIFY_SCOPES.join(","));
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Pure: the canonical HMAC message (all query params except hmac/signature, sorted). */
export function hmacMessage(params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [k, v] of params) {
    if (k === "hmac" || k === "signature") continue;
    pairs.push(`${k}=${v}`);
  }
  return pairs.sort().join("&");
}

/** Verify Shopify's callback HMAC (constant-time). */
export function verifyShopifyHmac(params: URLSearchParams, secret: string): boolean {
  const provided = params.get("hmac");
  if (!provided) return false;
  const digest = createHmac("sha256", secret).update(hmacMessage(params)).digest("hex");
  const a = Buffer.from(digest);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Verify a Shopify webhook (orders/create). Webhooks sign the RAW body with the
 * app secret and send it base64 in the X-Shopify-Hmac-Sha256 header — a
 * different scheme from the OAuth callback's query-string HMAC above.
 */
export function verifyWebhookHmac(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(digest);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Pure: pull our click id from a Shopify order (note_attributes[gcid] or the landing URL). */
export function extractClickId(order: {
  note_attributes?: { name?: string; value?: string }[] | null;
  landing_site?: string | null;
}): string | null {
  const attr = order.note_attributes?.find((a) => a?.name === "gcid")?.value;
  if (attr) return attr;
  const landing = order.landing_site ?? "";
  const m = landing.match(/[?&]gcid=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function exchangeShopifyToken(
  cfg: ShopifyOAuthConfig,
  shop: string,
  code: string,
): Promise<{ accessToken: string; scope: string }> {
  const res = await fetchWithTimeout(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: cfg.apiKey, client_secret: cfg.apiSecret, code }),
  });
  const data = (await res.json()) as { access_token?: string; scope?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Shopify token exchange failed: ${data.error ?? res.status}`);
  }
  return { accessToken: data.access_token, scope: data.scope ?? "" };
}
