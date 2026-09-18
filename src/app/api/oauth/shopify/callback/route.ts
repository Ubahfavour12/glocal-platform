import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  exchangeShopifyToken,
  normalizeShopDomain,
  shopifyConfigFromEnv,
  verifyShopifyHmac,
} from "@/lib/oauth/shopify";
import { registerOrdersWebhook } from "@/lib/oauth/shopify-live";
import { currentBusiness } from "@/lib/business/current";

/**
 * Shopify OAuth landing. Verifies the CSRF state + Shopify's callback HMAC,
 * exchanges the code for an access token, stores it on the business's
 * store_connections row, and best-effort registers the orders/create webhook so
 * sales flow in automatically. We store a shop-scoped token, never a password.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const jar = await cookies();
  const cookieVal = jar.get("shopify_oauth_state")?.value ?? "";
  jar.delete("shopify_oauth_state");
  const [expectedState, expectedShop] = cookieVal.split(":");

  const fail = (reason: string) => NextResponse.redirect(`${origin}/settings?store=${reason}`);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const shopParam = searchParams.get("shop");
  if (!code || !state || !shopParam || !expectedState || state !== expectedState) {
    return fail("state_mismatch");
  }

  let shop: string;
  try {
    shop = normalizeShopDomain(shopParam);
  } catch {
    return fail("bad_shop");
  }
  if (shop !== expectedShop) return fail("shop_mismatch");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const business = await currentBusiness<{ id: string } & Record<string, unknown>>(
    supabase,
    "id",
  );
  if (!business) return fail("no_business");

  try {
    const cfg = shopifyConfigFromEnv(origin);
    if (!verifyShopifyHmac(searchParams, cfg.apiSecret)) return fail("bad_hmac");

    const { accessToken } = await exchangeShopifyToken(cfg, shop, code);
    const service = createServiceClient();

    await service.from("store_connections").upsert(
      {
        business_id: business.id,
        provider: "shopify",
        status: "active",
        shop_domain: shop,
        access_token: accessToken,
        webhook_secret: cfg.apiSecret,
      },
      { onConflict: "business_id" },
    );

    // Best-effort: sales arrive on their own from here. Never block the connect.
    await registerOrdersWebhook(shop, accessToken, `${origin}/api/webhooks/shopify`).catch(() => {});

    return NextResponse.redirect(`${origin}/settings?store=success`);
  } catch {
    return fail("exchange_failed");
  }
}
