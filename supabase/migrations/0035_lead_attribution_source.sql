-- Not all attribution is equally trustworthy, and the table should say so.
--
-- There are now three ways a lead gets tied to an ad, and they are NOT
-- equivalent:
--
--   ctwa    Meta minted a click id when the ad was tapped and attached it to
--           the inbound message webhook, server to server. The sender cannot
--           see it, edit it or remove it. This is evidence.
--
--   prefill The wa.me link pre-filled "(ref GL-7K4)" and the sender left it in
--           place. It sits in their compose box and is fully editable, so a
--           missing code proves nothing and a present one can still be wrong.
--           This is a hint.
--
--   manual  Somebody typed it in. This is a person's word, which is often the
--           best evidence available and is still not a measurement.
--
-- Flattening these into one column would let a cost-per-won built on hints be
-- presented with the same confidence as one built on Meta's own click ids —
-- and the whole point of the lead work is to stop the product sounding more
-- certain than it is.

create type lead_attribution as enum ('ctwa', 'prefill', 'manual');

/**
 * Nullable, because leads created before this column existed genuinely do not
 * know how they were attributed. Backfilling them to 'manual' would be
 * inventing a fact, and NULL reads correctly as "we cannot say".
 */
alter table leads add column attribution lead_attribution;

comment on column leads.attribution is
  'How the ad link was established. ctwa = Meta click id (tamper-proof); prefill = editable ref code in the message (a hint); manual = entered by a person.';
