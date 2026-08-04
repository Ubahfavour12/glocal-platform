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

  return <AppShell>{children}</AppShell>;
}
