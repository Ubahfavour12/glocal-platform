import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/Sidebar";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { createClient } from "@/lib/supabase/server";

/**
 * The dashboard shell also guards it: every (app) route requires a signed-in
 * user. A signed-out visitor is sent to /login before any dashboard page
 * renders. The public marketing page (/) and /login stay open.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-end border-b border-line-soft px-8 py-3">
          <NotificationBell />
        </header>
        <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
