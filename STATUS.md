# Where the project is

The one file to open first, from any device. Everything below is the current
state, not a plan. Updated as work lands, so if it disagrees with reality the
file is wrong and should be fixed.

**Read this on your phone at:** github.com/Ubahfavour12/glocal-platform → this
file. No terminal, no Claude Code, no login beyond GitHub.

_Last updated: 5 September 2026_

---

## Right now

| | |
|---|---|
| Tests | **478 passing**, 1 skipped |
| Build | clean |
| Migrations applied | through `0020_engine_and_kind` |
| Commits | 85 on `master` |
| Live at | gg-platform-dun.vercel.app |
| Phase | 4 (money) built in code, switched off pending accounts |

## Blocked on you, not on code

These are the only things stopping the product working. None of them is
engineering.

| what | why it matters | where |
|---|---|---|
| **`HIGGSFIELD_API_KEY`** | primary **video** engine. Without it, video jobs silently fall through to fal and nothing warns you | `FOUNDER-ACTIONS.md` §0a |
| **`FAL_KEY`** into `platform/.env.local` | local renders are dormant without it | `FOUNDER-ACTIONS.md` §0b |
| **Vercel → Settings → Git** | connect `glocal-platform`, grant the GitHub App access to the private repo, confirm production branch is `master` not `main`. Then merges deploy themselves | Vercel dashboard |
| **`FLUTTERWAVE_WEBHOOK_HASH`** | currently empty. Webhooks fail closed, so a customer is charged and the wallet never credits | Vercel env |
| **CAC amendment** | unlocks Flutterwave/Paystack **live** keys | in progress |
| **Domain `useglocal.ai`** | unlocks business email → Meta App Review → TikTok dev app | not bought |
| **Meta Business Verification + App Review** | the master switch: no ads can run without it | needs domain first |

## What was built most recently

Newest first. `git log` carries the full reasoning for each; commit messages
here are written to be read later, not to be terse.

- **Video choice + cost recording** — Pipeline offers image or video per
  concept, priced (`video · 4x`) and disabled with a reason when the day's
  allowance cannot cover it. Every creative records which engine made it and
  what that engine charges.
- **Engine router** — both engines live from the start. Free tier is always
  fal; video prefers Higgsfield; images prefer fal; a missing key never stops a
  render. Rules are labelled as decisions or as facts, never confused.
- **The logo**, traced from the final artwork into the product.
- **Onboarding**, rebuilt as seven phone screens.

## Still to build

In order. Nothing here is started.

1. **Paystack** as the second money rail (after Flutterwave is proven live)
2. **Founder admin console** — every customer, wallet, verdict and error in one
   service-role view. Wanted before the dogfood, not after
3. **Sentry + PostHog** — needs free accounts creating
4. **Directions taps** as a counted footfall signal
5. **Terms of Service + Privacy Policy** — needs a lawyer
6. **30-day dogfood** on Gormup Gates wines

## How to check state yourself, without asking

```bash
git log --oneline -10     # what happened recently, in order
npx vitest run            # is everything still green
git status                # anything uncommitted
```

On a phone with no terminal: the GitHub commit list tells the same story, and
this file tells you where it left off.

## The other repo

Company documents live separately at **github.com/Ubahfavour12/glocal-docs** —
founding docs, legal, designer pack, and the two living checklists
(`FOUNDER-ACTIONS.md`, `DEFERRED-BACKLOG.md`). Kept apart on purpose so this
repo can be handed to an engineer without handing over the company's papers.
