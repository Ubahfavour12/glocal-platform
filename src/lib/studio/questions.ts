/**
 * Strategy Studio questions (Growth+ feature). The deep flow that goes beyond
 * quick-start onboarding to capture the marketing strategist's context —
 * audience, positioning, tone, offers, objections, proof — which the concept
 * engine then uses to write sharper, more specific ads. Pure data; the profile
 * synthesiser (profile.ts) turns the answers into a prompt block.
 */

export type StudioFieldType = "text" | "single" | "multi";

export interface StudioQuestion {
  id: string;
  label: string;
  hint?: string;
  type: StudioFieldType;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** cap for multi-select */
  max?: number;
}

export const STUDIO_QUESTIONS: StudioQuestion[] = [
  {
    id: "audience",
    label: "Who's your ideal customer?",
    hint: "Age, lifestyle, what they care about. Be specific — 'busy mums, 30-45, value convenience' beats 'everyone'.",
    type: "text",
    placeholder: "e.g. First-time skincare buyers, 20-35, want results without a 10-step routine",
  },
  {
    id: "problem",
    label: "What problem do you solve for them?",
    hint: "The pain your product removes.",
    type: "text",
    placeholder: "e.g. Breakouts that won't clear with drugstore products",
  },
  {
    id: "difference",
    label: "What makes you different from everyone else selling this?",
    hint: "Your real edge — ingredient, method, price, story.",
    type: "text",
    placeholder: "e.g. Dermatologist-formulated, fragrance-free, results in 2 weeks",
  },
  {
    id: "positioning",
    label: "Where do you sit on price?",
    type: "single",
    options: [
      { value: "budget", label: "Budget" },
      { value: "mid", label: "Mid-range" },
      { value: "premium", label: "Premium" },
      { value: "luxury", label: "Luxury" },
    ],
  },
  {
    id: "tone",
    label: "What tone fits your brand?",
    hint: "Pick up to three.",
    type: "multi",
    max: 3,
    options: [
      { value: "playful", label: "Playful" },
      { value: "premium", label: "Premium" },
      { value: "bold", label: "Bold" },
      { value: "warm", label: "Warm" },
      { value: "trustworthy", label: "Trustworthy" },
      { value: "edgy", label: "Edgy" },
      { value: "minimal", label: "Minimal" },
    ],
  },
  {
    id: "hero_offer",
    label: "What's the ONE product or offer to push first?",
    hint: "Your best seller or best-converting offer.",
    type: "text",
    placeholder: "e.g. The 3-step starter kit, 20% off first order",
  },
  {
    id: "objection",
    label: "What's the #1 reason people hesitate to buy?",
    hint: "The doubt the ads should overcome.",
    type: "text",
    placeholder: "e.g. 'Will it actually work for my skin type?'",
  },
  {
    id: "proof",
    label: "What proof do you have?",
    hint: "Reviews, results, numbers, credentials, press.",
    type: "text",
    placeholder: "e.g. 4.8★ from 2,000+ reviews, featured in Vogue",
  },
  {
    id: "avoid",
    label: "Anything the ads should NEVER say or claim?",
    hint: "Brand-safety and compliance no-gos.",
    type: "text",
    placeholder: "e.g. No 'cures acne', no before/after medical claims",
  },
  {
    id: "inspiration",
    label: "Any brands or ads whose style you love? (optional)",
    hint: "Helps the agent match a vibe.",
    type: "text",
    placeholder: "e.g. Glossier's clean look, that Dollar Shave Club energy",
  },
];

export type StudioAnswers = Record<string, string | string[]>;
