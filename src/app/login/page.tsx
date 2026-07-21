import { MagicLinkForm } from "@/components/auth/MagicLinkForm";

/**
 * Sign in (UF-1). Straightforward: returning customers already gave their
 * business details at sign-up, so this only authenticates. The magic-link
 * callback sends them to their dashboard.
 */
export default function LoginPage() {
  return <MagicLinkForm mode="signin" />;
}
