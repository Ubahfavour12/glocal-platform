import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizeUrl, normalizeShopDomain, shopifyConfigFromEnv } from "@/lib/oauth/shopify";

/**
 * Begin "Connect Shopify". The customer supplies their store (?shop=), we mint
 * a CSRF state cookie (carrying the shop so the callback can trust it), and
 * redirect to their own Shopify admin consent screen.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  let shop: string;
  try {
    shop = normalizeShopDomain(searchParams.get("shop") ?? "");
  } catch {
    return NextResponse.redirect(`${origin}/settings?store=bad_shop`);
  }

  let cfg;
  try {
    cfg = shopifyConfigFromEnv(origin);
  } catch {
    return NextResponse.redirect(`${origin}/settings?store=unconfigured`);
  }

  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set("shopify_oauth_state", `${state}:${shop}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(buildAuthorizeUrl(cfg, shop, state));
}
