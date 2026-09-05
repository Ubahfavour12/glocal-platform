import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { canRenderKind, VIDEO_CREDIT_WEIGHT } from "@/lib/creative/quota";
import { countRendersToday } from "@/lib/media/storage";
import { asPlan } from "@/lib/billing/plan";
import { PipelineFilter } from "@/components/pipeline/PipelineFilter";
import type { PipelineConcept } from "@/lib/pipeline/filter";

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
        />
      )}
    </div>
  );
}
