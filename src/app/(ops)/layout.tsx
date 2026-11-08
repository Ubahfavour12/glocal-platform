/**
 * The founder console's own shell.
 *
 * Deliberately NOT the customer AppShell. The console used to render inside
 * it, so the page that shows every customer's wallet also showed a customer
 * sidebar, a business switcher and an "ask the agent" button -- chrome for a
 * different job, on a page where a mis-click should not be possible.
 *
 * Nothing here links anywhere. The only way in is to know the address.
 */
export const metadata = {
  title: "Ops",
  // Not that a 404'd page would be indexed anyway, but saying so costs a line.
  robots: { index: false, follow: false },
};

/**
 * Always dark (see .ops-console in globals.css): a control room is read at a
 * glance, and its status colours are tuned for a dark ground.
 */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ops-console relative min-h-screen">
      <div aria-hidden="true" className="ops-grid pointer-events-none absolute inset-x-0 top-0 h-[520px]" />
      <div className="relative px-4 py-6 sm:px-6 lg:px-10">{children}</div>
    </div>
  );
}
