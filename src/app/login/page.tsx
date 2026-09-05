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
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const raw = (await searchParams).error;
  const key = Array.isArray(raw) ? raw[0] : raw;
  return <MagicLinkForm mode="signin" linkError={key ? REASONS[key] : undefined} />;
}
