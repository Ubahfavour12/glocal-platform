import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { canRenderKind, VIDEO_CREDIT_WEIGHT } from "@/lib/creative/quota";
import { countRendersToday } from "@/lib/media/storage";
import { asPlan } from "@/lib/billing/plan";
import { PipelineFilter } from "@/components/pipeline/PipelineFilter";
import type { PipelineConcept } from "@/lib/pipeline/filter";
import type { ApprovalPlanPayload } from "@/lib/orchestrator/plan-payload";

/** Slots the duel runs when the plan does not say otherwise. */
const DEFAULT_CHALLENGER_SLOTS = 2;

export const dynamic = "force-dynamic";
export const metadata = { title: "Pipeline" };

interface ConceptRow {
  id: string;
  rank: number;
  hook: string;
  storyboard: string[] | null;
  copy_angle: string;
  cta: string;
  source_pattern: string | null;
  rendered: boolean;
}

/** Strip the AI "tells" from generated copy: em/en dashes read as machine-written. */
function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s*[—–]\s*/g, ", ").trim();
}

export default async function PipelinePage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, plan")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Whether a video is affordable today, worked out here rather than guessed
  // in the browser, so the option is disabled with a reason instead of failing
  // after it is chosen. A free account never sees video offered at all.
  let videoAffordable = false;
  if (business) {
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("renders_per_day")
      .eq("business_id", business.id)
      .maybeSingle();
    const dailyLimit = (sub?.renders_per_day as number) ?? 2;
    const usedToday = await countRendersToday(supabase, business.id as string);
    videoAffordable =
      asPlan(business.plan as string | null) === "paid" &&
      canRenderKind({ usedToday, dailyLimit }, "video");
  }

  const concepts: ConceptRow[] = business
    ? (
        (await supabase
          .from("concepts")
          .select("id, rank, hook, storyboard, copy_angle, cta, source_pattern, rendered")
          .eq("business_id", business.id)
          .order("rank", { ascending: true })).data ?? []
      ) as ConceptRow[]
    : [];

  /**
   * Which concepts are actually in the next plan.
   *
   * Taken from the plan itself rather than from whether a button was pressed.
   * A plan has room for a fixed number of challengers, and picking again
   * rebuilds it, so a click is not proof of a place in it.
   */
  const plannedConceptIds: string[] = [];
  let challengerSlots = DEFAULT_CHALLENGER_SLOTS;
  let walletEmpty = false;
  if (business) {
    /*
     * An empty wallet is the real reason picking does nothing, and until now
     * the screen never said so. The agent pauses spend when the balance hits
     * zero, which is correct, and the resulting plan has no challengers at all.
     * The customer then picks a concept, the rebuild still has nowhere to put
     * it, and nothing happens with no explanation offered. Silence is the bug,
     * not the pause.
     */
    const { data: balanceRow } = await supabase
      .from("wallet_balances")
      .select("balance_usd_minor")
      .eq("business_id", business.id)
      .maybeSingle();
    walletEmpty = Number(balanceRow?.balance_usd_minor ?? 0) <= 0;

    // "awaiting" and "approved" are the two live states. The first version of
    // this queried "pending", which is not a value approval_status has, so the
    // query matched nothing on every account and no concept ever showed as
    // being in tomorrow's test. The error was discarded rather than surfaced,
    // which is why it looked like the feature simply did nothing.
    const { data: nextPlan, error: planError } = await supabase
      .from("approvals")
      .select("payload")
      .eq("business_id", business.id)
      .in("status", ["awaiting", "approved"])
      .order("plan_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (planError) {
      // Never silently: a badge that cannot be computed must not look like a
      // plan that contains nothing.
      console.error("pipeline: could not read tomorrow's plan", planError.message);
    }
    const payload = nextPlan?.payload as ApprovalPlanPayload | null;
    for (const ch of payload?.challengers ?? []) {
      if (ch?.conceptId) plannedConceptIds.push(ch.conceptId);
    }
    // The plan's own challenger count is the real capacity: a small budget
    // funds fewer than the default, and the customer should see that number
    // rather than one we assumed. A plan that exists with zero challengers is
    // a genuine nought, not a missing number, so it is not overwritten by the
    // default -- that is precisely the paused case worth showing.
    if (nextPlan) challengerSlots = payload?.challengers?.length ?? 0;
  }

  const renderedCount = concepts.filter((c) => c.rendered).length;

  // Shape once on the server so the client filter stays a pure list operation.
  const items: PipelineConcept[] = concepts.map((c) => ({
    id: c.id,
    rank: c.rank,
    hook: clean(c.hook),
    beats: (c.storyboard ?? []).filter(Boolean).map(clean),
    copyAngle: clean(c.copy_angle),
    cta: clean(c.cta),
    sourcePattern: c.source_pattern ? clean(c.source_pattern) : null,
    rendered: c.rendered,
  }));

  return (
    <div className="mx-auto max-w-4xl 2xl:max-w-5xl">
      <PageHeader
        label="pipeline"
        title="Concepts, ranked"
        subtitle="Your best-fit ad ideas, reverse-engineered from what's winning in your niche."
        stat={{ value: String(concepts.length), caption: `of 50 · ${renderedCount} rendered` }}
      />

      {concepts.length === 0 ? (
        <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
          <p className="mx-auto max-w-md text-sm text-ink-muted">
            Your concept library builds here right after onboarding. The research agent studies the
            most viral ads in your niche and turns them into 50 ranked, scripted ideas. Only the two
            entering each day&apos;s test get rendered, so you always see what&apos;s coming next.
          </p>
        </div>
      ) : (
        <PipelineFilter
          concepts={items}
          businessId={(business?.id as string | undefined) ?? null}
          videoAffordable={videoAffordable}
          videoCredits={VIDEO_CREDIT_WEIGHT}
          plannedConceptIds={plannedConceptIds}
          challengerSlots={challengerSlots}
          walletEmpty={walletEmpty}
        />
      )}
    </div>
  );
}
