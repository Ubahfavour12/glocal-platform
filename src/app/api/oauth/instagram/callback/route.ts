import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  exchangeInstagramCode,
  exchangeInstagramLongLived,
  fetchInstagramProfile,
  instagramOAuthConfigFromEnv,
  tokenExpiry,
} from "@/lib/oauth/instagram";

/**
 * Instagram-direct OAuth landing. Verifies the CSRF state, exchanges the code
 * for a long-lived Instagram token, reads the account handle, and stores it as
 * an active instagram social_connection (RLS-scoped to the owner's business).
 * We store the account token, never a password. Failures return to Settings.
 */
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const jar = await cookies();
  const expectedState = jar.get("instagram_oauth_state")?.value;
  jar.delete("instagram_oauth_state");

  const fail = (reason: string) => NextResponse.redirect(`${origin}/settings?connect=${reason}`);

  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("ig_state_mismatch");
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
    const cfg = instagramOAuthConfigFromEnv(origin);
    const short = await exchangeInstagramCode(cfg, code);
    const long = await exchangeInstagramLongLived(cfg, short.accessToken);
    const profile = await fetchInstagramProfile(long.accessToken);

    const expiresAt = tokenExpiry(long.expiresInSeconds, new Date())?.toISOString() ?? null;
    const service = createServiceClient();

    await service.from("social_connections").insert({
      business_id: business.id,
      provider: "instagram",
      network: "instagram",
      status: "active",
      access_token: long.accessToken,
      token_expires_at: expiresAt,
      platform_account_id: profile.id || short.userId,
      display_name: profile.username || null,
    });

    return NextResponse.redirect(`${origin}/settings?connect=ig_success`);
  } catch {
    return fail("ig_exchange_failed");
  }
}
