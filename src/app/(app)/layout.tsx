import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { createClient } from "@/lib/supabase/server";

/**
 * The dashboard shell also guards it: every (app) route requires a signed-in
 * user. A signed-out visitor is sent to /login before any dashboard page
 * renders. The public marketing page (/) and /login stay open. Layout stays a
 * server component for the auth check; AppShell (client) owns the retractable
 * sidebar and header chrome.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The phone tab bar and tablet rail both need to show the Approve badge
  // without each re-querying it, so it is read once here and passed down.
  let awaitingApproval = false;
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (business) {
    const { count } = await supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("business_id", business.id)
      .eq("status", "awaiting");
    awaitingApproval = (count ?? 0) > 0;
  }

  return <AppShell awaitingApproval={awaitingApproval}>{children}</AppShell>;
}
