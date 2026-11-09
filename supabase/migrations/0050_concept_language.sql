-- Which language a concept was written in.
--
-- THE BUG THIS FIXES. Choosing Pidgin in settings changed the prompt, and
-- changed nothing else. The pool stops topping up at its target -- fifty
-- concepts -- and the account with Pidgin selected already held fifty, all of
-- them written in English before the setting existed. So the generator was
-- never asked for a Pidgin concept, the nightly run kept drawing English ones
-- from the shelf, and the setting looked broken while being wired correctly.
--
-- The pool had no idea what language anything in it was, so it could not know
-- it was full of the wrong thing.
--
-- NOT A PURGE. The obvious fix -- delete the concepts when the language
-- changes -- throws away work the customer may want back the moment they
-- switch to English again, and makes a settings toggle destructive. Stamping
-- the language instead means the pool is counted, listed and drawn per
-- language: Pidgin fills up from empty, the English fifty sit untouched, and
-- switching back finds them where they were.
--
-- 'english' is the right default for every existing row. They were written
-- before any language could be chosen, by a prompt with no language
-- paragraph in it, which is exactly what English means here.

alter table concepts
  add column if not exists language text not null default 'english';

-- Every read of this table is now "this business, this language, by rank".
-- There was no index on business_id at all, so this is the first one that
-- matches how the pool is actually used.
create index if not exists concepts_business_language_rank_idx
  on concepts (business_id, language, rank);
