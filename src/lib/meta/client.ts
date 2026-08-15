/**
 * Meta Marketing API client — Task #4 (TRD §3.3 "No-Link ad infrastructure").
 * Thin, typed wrapper over the Graph API. Every function here was proven
 * live against the STAGING portfolio on 2026-07-11:
 *   child account act_1396784098962857 → assignment → campaign 52561218382244 (PAUSED).
 *
 * SAFETY RULES (Dev Plan: two BMs, always):
 * - Only ever called with the staging portfolio until launch.
 * - Campaigns are created PAUSED; enabling is a separate, deliberate call
 *   that the orchestrator gates behind wallet balance + approval.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaConfig {
  accessToken: string;
  businessId: string; // portfolio the platform operates (staging until launch)
}

export function metaConfigFromEnv(): MetaConfig {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const businessId = process.env.META_STAGING_BUSINESS_ID; // staging until launch
  if (!accessToken || !businessId) {
    throw new Error("META_ACCESS_TOKEN / META_STAGING_BUSINESS_ID not configured");
  }
  return { accessToken, businessId };
}

async function graph<T>(
  path: string,
  init: { method?: "GET" | "POST"; params?: Record<string, string> },
  accessToken: string,
): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  const body = new URLSearchParams({ ...init.params, access_token: accessToken });
  const res =
    init.method === "POST"
      ? await fetch(url, { method: "POST", body })
      : await fetch(`${url}?${body}`, { method: "GET" });
  const data = (await res.json()) as T & { error?: { message: string; error_user_msg?: string } };
  if (data.error) {
    throw new Error(
      `Meta API ${path}: ${data.error.message}${
        data.error.error_user_msg ? ` — ${data.error.error_user_msg}` : ""
      }`,
    );
  }
  return data;
}

/** Step 1 of provisioning: create the customer's isolated child ad account. */
export async function createChildAdAccount(
  cfg: MetaConfig,
  name: string,
  currency = "USD",
): Promise<{ accountId: string }> {
  const data = await graph<{ account_id: string }>(
    `${cfg.businessId}/adaccount`,
    {
      method: "POST",
      params: {
        name,
        currency,
        timezone_id: "1",
        end_advertiser: "NONE",
        media_agency: "NONE",
        partner: "NONE",
      },
    },
    cfg.accessToken,
  );
  return { accountId: `act_${data.account_id}` };
}

/** Step 2: grant a business-scoped user (later: system user) management of it. */
export async function assignBusinessUser(
  cfg: MetaConfig,
  adAccountId: string,
  businessUserId: string,
): Promise<void> {
  await graph(
    `${adAccountId}/assigned_users`,
    {
      method: "POST",
      params: { user: businessUserId, tasks: '["MANAGE","ADVERTISE","ANALYZE"]' },
    },
    cfg.accessToken,
  );
}

/** Resolve the platform's own business-scoped user id (cached upstream). */
export async function getBusinessUsers(
  cfg: MetaConfig,
): Promise<{ id: string; name: string; role: string }[]> {
  const data = await graph<{ data: { id: string; name: string; role: string }[] }>(
    `${cfg.businessId}/business_users`,
    { params: { fields: "id,name,role" } },
    cfg.accessToken,
  );
  return data.data;
}

export type CampaignObjective =
  | "OUTCOME_TRAFFIC"
  | "OUTCOME_SALES"
  | "OUTCOME_LEADS"
  | "OUTCOME_ENGAGEMENT";

/**
 * Step 3: create a campaign — ALWAYS paused at creation. Going live is a
 * separate explicit call, gated by the approval flow and wallet balance.
 */
export async function createPausedCampaign(
  cfg: MetaConfig,
  adAccountId: string,
  name: string,
  objective: CampaignObjective,
): Promise<{ campaignId: string }> {
  const data = await graph<{ id: string }>(
    `${adAccountId}/campaigns`,
    {
      method: "POST",
      params: {
        name,
        objective,
        status: "PAUSED",
        special_ad_categories: "[]",
        is_adset_budget_sharing_enabled: "false",
      },
    },
    cfg.accessToken,
  );
  return { campaignId: data.id };
}

/**
 * Step 4: create an ad set — PAUSED, macro-geo targeting ONLY (Creative-Led
 * Targeting, Blueprint §4.4: the agent never touches demographics). Budget in
 * USD minor units, already clamped by the guardrails before reaching here.
 * Proven live: ad set 52561219529444 ($10/day, GB) on 2026-07-11.
 */
export async function createPausedAdSet(
  cfg: MetaConfig,
  adAccountId: string,
  params: {
    name: string;
    campaignId: string;
    dailyBudgetUsdMinor: number;
    countries: string[];
    /** Required minimum age for restricted categories (alcohol, dating). */
    ageMin?: number;
    optimizationGoal?: "LINK_CLICKS" | "OFFSITE_CONVERSIONS" | "LEAD_GENERATION";
  },
): Promise<{ adSetId: string }> {
  const data = await graph<{ id: string }>(
    `${adAccountId}/adsets`,
    {
      method: "POST",
      params: {
        name: params.name,
        campaign_id: params.campaignId,
        status: "PAUSED",
        daily_budget: String(params.dailyBudgetUsdMinor),
        billing_event: "IMPRESSIONS",
        optimization_goal: params.optimizationGoal ?? "LINK_CLICKS",
        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        // Only geo, plus any age floor the category legally requires. No
        // interests or demographics: the creative finds the audience, and
        // narrowing it raises costs and starves the algorithm of learning.
        targeting: JSON.stringify({
          geo_locations: { countries: params.countries },
          ...(params.ageMin ? { age_min: params.ageMin } : {}),
        }),
      },
    },
    cfg.accessToken,
  );
  return { adSetId: data.id };
}

export type CallToAction = "SHOP_NOW" | "SIGN_UP" | "CONTACT_US" | "LEARN_MORE";

/** Map the business goal to the ad's call-to-action button. */
export function ctaForGoal(goal: "sales" | "leads" | "whatsapp" | "visits"): CallToAction {
  switch (goal) {
    case "sales":
      return "SHOP_NOW";
    case "leads":
      return "SIGN_UP";
    case "whatsapp":
      return "CONTACT_US";
    case "visits":
      return "LEARN_MORE";
  }
}

/**
 * Step 5: create a link-ad creative. The link is ALWAYS our smart link, so
 * every click is tracked platform-side regardless of the ad network
 * (proven live: creative 902931766182353 on 2026-07-12). imageUrl is
 * optional until the rendering lane is active — Meta accepts link ads
 * without an explicit image (it pulls from the page/link preview).
 */
export async function createLinkAdCreative(
  cfg: MetaConfig,
  adAccountId: string,
  params: {
    name: string;
    pageId: string;
    link: string; // the smart link URL
    message: string; // primary text (the concept's copy)
    cta: CallToAction;
    imageUrl?: string;
  },
): Promise<{ creativeId: string }> {
  const linkData: Record<string, unknown> = {
    link: params.link,
    message: params.message,
    call_to_action: { type: params.cta, value: { link: params.link } },
  };
  if (params.imageUrl) linkData.picture = params.imageUrl;

  const data = await graph<{ id: string }>(
    `${adAccountId}/adcreatives`,
    {
      method: "POST",
      params: {
        name: params.name,
        object_story_spec: JSON.stringify({ page_id: params.pageId, link_data: linkData }),
      },
    },
    cfg.accessToken,
  );
  return { creativeId: data.id };
}

/**
 * Step 6: create the ad itself — PAUSED, like everything else. This is the
 * final object; on an account without a payment method Meta rejects it
 * (error 1359188), which the launcher records as "awaiting payment method"
 * rather than a failure. Completes at dogfooding.
 */
export async function createPausedAd(
  cfg: MetaConfig,
  adAccountId: string,
  params: { name: string; adSetId: string; creativeId: string },
): Promise<{ adId: string }> {
  const data = await graph<{ id: string }>(
    `${adAccountId}/ads`,
    {
      method: "POST",
      params: {
        name: params.name,
        adset_id: params.adSetId,
        creative: JSON.stringify({ creative_id: params.creativeId }),
        status: "PAUSED",
      },
    },
    cfg.accessToken,
  );
  return { adId: data.id };
}

export async function listCampaigns(
  cfg: MetaConfig,
  adAccountId: string,
): Promise<{ id: string; name: string; status: string; objective: string }[]> {
  const data = await graph<{
    data: { id: string; name: string; status: string; objective: string }[];
  }>(
    `${adAccountId}/campaigns`,
    { params: { fields: "id,name,status,objective" } },
    cfg.accessToken,
  );
  return data.data;
}

/** Map a business goal (onboarding) to the Meta campaign objective. */
export function objectiveForGoal(goal: "sales" | "leads" | "whatsapp" | "visits"): CampaignObjective {
  switch (goal) {
    case "sales":
      return "OUTCOME_SALES";
    case "leads":
      return "OUTCOME_LEADS";
    case "whatsapp":
      return "OUTCOME_ENGAGEMENT";
    case "visits":
      return "OUTCOME_TRAFFIC";
  }
}
