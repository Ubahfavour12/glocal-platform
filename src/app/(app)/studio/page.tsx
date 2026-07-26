import { PageHeader } from "@/components/ui/PageHeader";

export const metadata = { title: "Strategy Studio" };

export default function StudioPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        label="strategy studio"
        title="Tune your agent"
        subtitle="The deep consultative flow that reshapes how the agent thinks. Optional, nothing blocks a launch."
      />
      <div className="mt-8 rounded-card border border-line bg-surface-raised p-8 text-center">
        <p className="text-sm text-ink-muted">
          The deep consultative flow lives here, ten questions that reshape the
          agent&apos;s logic live. Defaults were inferred from your quick-start
          answers; nothing blocks a launch.
        </p>
      </div>
    </div>
  );
}
