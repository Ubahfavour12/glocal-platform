import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchPages,
  metaOAuthConfigFromEnv,
  tokenExpiry,
} from "@/lib/oauth/meta";

/**
 * Meta OAuth landing. Verifies the CSRF state, exchanges the code for a
 * long-lived token, discovers the customer's Page(s) + linked Instagram, and
 * stores each as an active social_connection (RLS-scoped to their business).
 * We store PAGE TOKENS, never the user's password. Failures return to Settings
 * with a flag rather than crashing.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const jar = await cookies();
  const expectedState = jar.get("meta_oauth_state")?.value;
  jar.delete("meta_oauth_state");

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/settings?connect=${reason}`);

  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("state_mismatch");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!business) return fail("no_business");

  try {
    const cfg = metaOAuthConfigFromEnv(origin);
    const short = await exchangeCodeForToken(cfg, code);
    const long = await exchangeForLongLivedToken(cfg, short.accessToken);
    const pages = await fetchPages(long.accessToken);
    if (pages.length === 0) return fail("no_pages");

    const expiresAt = tokenExpiry(long.expiresInSeconds, new Date())?.toISOString() ?? null;
    const service = createServiceClient();

    // One connection row per network (facebook + instagram when present).
    const rows = pages.flatMap((p) => {
      const base = {
        business_id: business.id,
        provider: "meta",
        status: "active",
        access_token: p.pageAccessToken,
        token_expires_at: expiresAt,
        display_name: p.name,
      };
      const out = [{ ...base, network: "facebook", platform_account_id: p.pageId }];
      if (p.instagramId) {
        out.push({ ...base, network: "instagram", platform_account_id: p.instagramId });
      }
      return out;
    });
    await service.from("social_connections").insert(rows);

    return NextResponse.redirect(`${origin}/settings?connect=success`);
  } catch {
    return fail("exchange_failed");
  }
}
