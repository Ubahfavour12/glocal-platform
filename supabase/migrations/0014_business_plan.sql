-- 0014: Freemium plan model (Phase 4 prep, dormant until payments + Higgsfield).
-- Free tier gets onboarding + concepts + ONE render, then must upgrade; paid
-- unlocks video renders, volume rendering, and launching ads.
alter table businesses
  add column if not exists plan text not null default 'free',
  add column if not exists free_render_used boolean not null default false;
