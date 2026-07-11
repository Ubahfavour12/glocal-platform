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
        targeting: JSON.stringify({ geo_locations: { countries: params.countries } }),
      },
    },
    cfg.accessToken,
  );
  return { adSetId: data.id };
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
