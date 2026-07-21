import { MagicLinkForm } from "@/components/auth/MagicLinkForm";

/**
 * Sign up (UF-1). New customers authenticate, then the magic-link callback
 * (no business row yet) routes them into onboarding, where we collect their
 * business details. This is the only path that asks the setup questions.
 */
export default function SignupPage() {
  return <MagicLinkForm mode="signup" />;
}
