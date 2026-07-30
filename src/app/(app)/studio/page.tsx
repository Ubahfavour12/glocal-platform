import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { StudioForm } from "@/components/studio/StudioForm";
import { answeredCount } from "@/lib/studio/profile";
import { STUDIO_QUESTIONS, type StudioAnswers } from "@/lib/studio/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Strategy Studio" };

export default async function StudioPage() {
  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("strategy_profile")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!business) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader label="strategy studio" title="Tune your agent" />
        <p className="mt-6 text-sm text-ink-muted">Finish onboarding first, then tune your agent here.</p>
      </div>
    );
  }

  const answers = (business.strategy_profile as StudioAnswers | null) ?? {};
  const done = answeredCount(answers);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        label="strategy studio"
        title="Tune your agent"
        subtitle="The deep brief. The more the agent knows about your business, the sharper and more specific its ad concepts get."
        stat={{ value: `${done}/${STUDIO_QUESTIONS.length}`, caption: "answered" }}
      />

      <div className="mt-6 rounded-card border border-line bg-surface-raised p-4 text-xs text-ink-muted">
        Everything here is optional — your quick-start answers already run the agent. But each field
        you fill makes the concepts noticeably better. <span className="text-ink-faint">Part of Growth &amp; Scale plans.</span>
      </div>

      <StudioForm initial={answers} />
    </div>
  );
}
