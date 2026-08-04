import { ApprovalCard } from "@/components/approval/ApprovalCard";
import type { SellableAd } from "@/components/approval/SalesCheckIn";
import type { ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approve" };

type Supa = Awaited<ReturnType<typeof createClient>>;

/**
 * The seller attributes a sale by picking one of their own live ads, so we
 * surface each ad's smart-link code (what record_sale validates) alongside a
 * human label (the concept hook). Walked step by step through the launch chain
 * — smart_links -> ads -> creatives -> concepts — with plain `in` lookups so it
 * never depends on nested-embedding quirks. Empty (no ads live yet) is normal.
 */
async function loadSellableAds(supabase: Supa, businessId: string): Promise<SellableAd[]> {
  const { data: links } = await supabase
    .from("smart_links")
    .select("code, ad_id, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(12);
  const rows = (links ?? []) as { code: string; ad_id: string | null }[];
  if (rows.length === 0) return [];

  const adIds = [...new Set(rows.map((r) => r.ad_id).filter(Boolean))] as string[];
  const { data: ads } = adIds.length
    ? await supabase.from("ads").select("id, creative_id").in("id", adIds)
    : { data: [] as { id: string; creative_id: string | null }[] };
  const adById = new Map((ads ?? []).map((a) => [a.id, a as { id: string; creative_id: string | null }]));

  const creativeIds = [...new Set((ads ?? []).map((a) => a.creative_id).filter(Boolean))] as string[];
  const { data: creatives } = creativeIds.length
    ? await supabase.from("creatives").select("id, concept_id, ad_copy").in("id", creativeIds)
    : { data: [] as { id: string; concept_id: string | null; ad_copy: string | null }[] };
  const creativeById = new Map((creatives ?? []).map((c) => [c.id, c]));

  const conceptIds = [...new Set((creatives ?? []).map((c) => c.concept_id).filter(Boolean))] as string[];
  const { data: concepts } = conceptIds.length
    ? await supabase.from("concepts").select("id, hook").in("id", conceptIds)
    : { data: [] as { id: string; hook: string }[] };
  const hookByConcept = new Map((concepts ?? []).map((c) => [c.id, c.hook]));

  return rows.map((r) => {
    const ad = r.ad_id ? adById.get(r.ad_id) : undefined;
    const creative = ad?.creative_id ? creativeById.get(ad.creative_id) : undefined;
    const hook = creative?.concept_id ? hookByConcept.get(creative.concept_id) : undefined;
    const raw = (hook || creative?.ad_copy || `Ad ${r.code}`).toString().trim();
    const label = raw.length > 80 ? `${raw.slice(0, 77)}…` : raw;
    return { code: r.code, label };
  });
}

/**
 * The Approve tab, shows the latest awaiting plan for the signed-in user's
 * business, or an empty state. This is the mobile app's center tab (UI Plan
 * §2.2): approval-first.
 */
export default async function ApprovePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  let approval: { id: string; payload: ApprovalPlanPayload; businessId: string } | null = null;
  let sellableAds: SellableAd[] = [];
  if (userData.user) {
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (business) {
      const { data } = await supabase
        .from("approvals")
        .select("id, payload")
        .eq("business_id", business.id)
        .eq("status", "awaiting")
        .order("plan_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        approval = {
          id: data.id,
          payload: data.payload as ApprovalPlanPayload,
          businessId: business.id,
        };
        sellableAds = await loadSellableAds(supabase, business.id);
      }
    }
  }

  if (!approval) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="datalabel">approve</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nothing to approve yet</h1>
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
          <p className="text-sm text-ink-muted">
            Each evening, once your campaigns are running, tomorrow&apos;s plan
            appears here, two fresh challenger ads and a budget split, waiting
            for one tap.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ApprovalCard
      approvalId={approval.id}
      plan={approval.payload}
      businessId={approval.businessId}
      ads={sellableAds}
    />
  );
}
