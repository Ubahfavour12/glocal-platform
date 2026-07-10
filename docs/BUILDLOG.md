# Build Log

Doc-first rule: decisions change in `01-FOUNDING-DOCS` before code. Each entry
records what shipped, what proved it, and what's next.

## 2026-07-10 — Slice A foundation

- Scaffolded Next.js 16 / React 19 / Tailwind 4 / TS (App Router, src dir).
- Design tokens per UI Plan §1 (`src/app/globals.css`): dark premium surfaces,
  single amber accent, mono datalabels.
- Full TRD §2 schema as `supabase/migrations/0001_core_schema.sql` (21 tables,
  RLS on everything, append-only ledger trigger, $10/day budget floor in a
  check constraint).
- Domain logic with vitest coverage (money/safety code first, Dev Plan §4):
  - `src/lib/money/fx.ts` — hourly rate snapshots, 3% buffer, staleness guard,
    round-up charging / round-down crediting.
  - `src/lib/money/ledger.ts` — signed append-only entries, derived balance,
    canDebit (never negative), runway, $70 minimum first deposit.
  - `src/lib/guardrails/budget.ts` — 30%/24h escalation cap, persona splits
    (80/20, 70/30 default, 60/40), integer-exact.
  - `src/lib/verdicts/verdict.ts` — 24h + 5,000 impressions thresholds,
    rolling 3-day window, ROAS→CPCI→engagement hierarchy, tie = no verdict.
- Smart Link redirect route `src/app/l/[code]/route.ts` (fire-and-forget click
  logging; DB wiring lands with Task #3).
- Dashboard shell in preview mode: sidebar (UI Plan §2.1), Today, Duel,
  Pipeline, Organic, Wallet, Studio, Activity, Settings.
- Supabase server/client/service helpers; `.env.example` for all integrations.

Late-locked decisions folded in: auto-created FB Page/TikTok identity per
business; $10/day budget floor; wallet top-ups web-only (mobile opens web
checkout); hosted landing pages deferred to v2.

Next: Task #2 (auth + Quick-Start wizard), Task #3 (wallet live + FX provider
+ reconciliation), Task #4 (Meta child-account provisioning on the STAGING BM).

USER ACTION REQUIRED (Dev Plan week-1 filings — cannot be done by the agent):
Meta Business verification + Marketing API app, TikTok Business Center API,
Google Ads developer token, Stripe + Flutterwave onboarding, Apple/Google
developer accounts, Metricool + Higgsfield + YouTube Data API keys.
