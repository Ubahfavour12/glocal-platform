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

## 2026-07-11 — Auth + database live (Task #2 complete)

- Supabase project "marketing-platform" created (eu-west-2) via the connected
  integration; core schema migration applied to the cloud; RLS verified live.
- Magic-link auth end-to-end: /login (signInWithOtp) → /auth/callback
  (code exchange, new users → /onboarding, returning → /today).
- Onboarding finish inserts a real `businesses` row for signed-in users;
  demo mode (localStorage) still works without a session.
- Outstanding: user to copy the service-role key from the dashboard into
  .env.local (needed by orchestrator jobs in Slice B, not before).

## 2026-07-11 — Wallet goes live (Task #3 core)

- Migration 0002 applied to cloud: wallet_balances view (RLS-safe),
  ensure_wallet, record_dev_topup (capped $200/call, $1,000 lifetime,
  dropped before launch), record_spend (atomic spend+markup, row-locked,
  never-negative, service-role only).
- Wallet page reads the signed-in user's real balance, runway, and last 10
  ledger entries; Add-funds buttons work end-to-end through the capped dev
  path. Signed-out remains preview mode.
- /api/jobs/reconcile: CRON_SECRET-guarded daily integrity job (negative
  balances, sign/kind mismatches) writing to audit_log; PSP and ad-network
  comparison phases activate when those connect.
- Live FX engine (earlier commit): keyless provider + 3% buffer + /api/fx.
- Remaining for full Task #3 close: Stripe/Flutterwave webhooks (blocked on
  user's PSP accounts → legal entity), service-role key paste.

## 2026-07-11 — Meta No-Link pipeline PROVEN LIVE (Task #4 underway)

- User completed Meta ladder: 2FA, two Business Portfolios (staging
  1700924244465585 / production 1007610768736319), developer app
  "GG Platform Dev" (1905331716812155), 60-day token with ads_management +
  ads_read + business_management. Account standing verified clean.
- PROVEN VIA API against STAGING: created child ad account
  act_1396784098962857 → assigned business user → created PAUSED campaign
  52561218382244 (OUTCOME_TRAFFIC). The core No-Link mechanism works on
  dev tier, day one.
- src/lib/meta/client.ts captures the proven sequence as typed functions;
  campaigns are always born PAUSED, enabling is a separate gated call;
  module verified live (listCampaigns returns the test campaign).
- Next for Task #4: Facebook Page per business (Meta doesn't allow page
  creation via API — the customer-branded page gets created via Business
  Suite UI or during onboarding flow), ad set + creative + ad chain, then
  wire provisioning to onboarding.

## 2026-07-12 — Task #4 code-complete; app Live; platform deployed publicly

- Deployed to Vercel production (user-run CLI):
  https://gg-platform-favours-projects-c39118ad.vercel.app — landing,
  privacy policy, dashboard, and the Smart Link redirect all verified live
  (production /l/demo issues real click IDs).
- Meta app 1905331716812155 switched to LIVE (privacy URL requirement met by
  the deployed /privacy page). NOTE: a duplicate app 2002638317043972 exists
  — ignore, delete later.
- Chain proven on the real child account: creative 902931766182353 created
  (image + page 1225546887308248 + tracked smart link). The final ad object
  is blocked ONLY by "no payment method" (error 1359188) — by design, this
  account cannot spend. Final link completes at dogfooding when a payment
  method is added.
- Sandbox route abandoned: act_4469742386688526 rejects all tokens (owner
  grant error) despite correct app/scopes — Meta sandboxes are effectively
  deprecated. Not worth further time.
- Tokens: main 60-day token expires 2026-09-09; sandbox-page token unused.

## 2026-07-12 — COMPANY FOUND + Flutterwave live in test mode (Task #3 nearly closed)

- Game-changer: user already owns UBAHGRID SERVICE LTD (RC 8566798, ACTIVE,
  inc. 19 Jun 2025, TIN 33298804-0001, SCUML SC251516852, user = sole
  director, 75%). UK Ltd plan DROPPED — deferred to "only if Stripe needed".
- Designer contract amended: "the Company" explicitly excludes UBAHGRID;
  designer's 10% attaches to the Product (and a future product company),
  UBAHGRID acts as operator only.
- Flutterwave merchant created (test mode, NGN/USD/GBP/EUR balances); test
  secret key proven by creating a real hosted checkout link.
- Migration 0003 applied: record_psp_topup (service-role only, idempotent
  on psp_ref — double webhooks can never double-credit).
- Full checkout flow built: /api/wallet/checkout (auth'd, quotes NGN at
  buffered rate, meta carries quoted rate) → Flutterwave hosted page →
  /api/wallet/confirm (verifies via FW API, never trusts query params,
  credits floor-rounded) + /api/webhooks/flutterwave (verif-hash gated,
  re-verifies, same psp_ref = idempotent with confirm). Wallet UI has real
  "Pay with card (₦)" alongside capped dev buttons. 86 tests green.
- Remaining Task #3: compliance approval for LIVE keys (user uploads docs);
  webhook hash config + Vercel env vars when deploying payments.
