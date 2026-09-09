import { MagicLinkForm, type LinkError } from "@/components/auth/MagicLinkForm";

/**
 * Sign in (UF-1). Straightforward: returning customers already gave their
 * business details at sign-up, so this only authenticates. The magic-link
 * callback sends them to their dashboard.
 *
 * When a link fails, the callback sends the customer back here with ?error=.
 * That was previously read by nobody, so a failed sign-in looked exactly like
 * arriving at the page fresh: an empty email box and no hint that anything had
 * gone wrong, let alone that opening the link on a different device was the
 * cause. Now the reason is shown.
 */
const REASONS: Record<string, LinkError> = {
  device: "device",
  expired: "expired",
  link: "expired", // the old generic value, kept so older links still explain themselves
  idle: "idle",
  absolute: "absolute",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // Two different ways to arrive here needing an explanation: a link that did
  // not work (?error=) and a session the proxy ended (?timeout=). Without the
  // second, an idle sign-out dumps someone on an empty login box with no idea
  // why -- which reads as the app having lost their work.
  const timeout = one(params.timeout);
  const key = timeout ?? one(params.error);
  return <MagicLinkForm mode="signin" linkError={key ? REASONS[key] : undefined} />;
}
