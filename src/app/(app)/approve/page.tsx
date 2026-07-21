import { ApprovalCard } from "@/components/approval/ApprovalCard";
import type { ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The Approve tab — shows the latest awaiting plan for the signed-in user's
 * business, or an empty state. This is the mobile app's center tab (UI Plan
 * §2.2): approval-first.
 */
export default async function ApprovePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();

  let approval: { id: string; payload: ApprovalPlanPayload; businessId: string } | null = null;
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
      if (data)
        approval = {
          id: data.id,
          payload: data.payload as ApprovalPlanPayload,
          businessId: business.id,
        };
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
            appears here — two fresh challenger ads and a budget split — waiting
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
    />
  );
}
