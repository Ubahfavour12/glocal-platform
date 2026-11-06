-- The language the agent writes this business's AD COPY in. Not app language:
-- the dashboard stays English. Every ad before this column was English, so
-- that is the default and existing rows keep their behaviour exactly.
--
-- Constrained rather than free text on purpose. A typo in a free-text language
-- field becomes an instruction the model half-follows, and an ad running to a
-- paying customer's audience is not where you want to discover that.
alter table businesses
  add column if not exists ad_language text not null default 'english';

alter table businesses
  drop constraint if exists businesses_ad_language_check;

alter table businesses
  add constraint businesses_ad_language_check
  check (ad_language in ('english', 'pidgin', 'hausa', 'yoruba', 'igbo'));

comment on column businesses.ad_language is
  'Language for generated ad copy (hook/copy/CTA). Not UI language. See src/lib/copy/language.ts.';
