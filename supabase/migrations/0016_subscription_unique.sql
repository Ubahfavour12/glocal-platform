-- 0016: one active subscription row per business (lets activateSubscription upsert
-- on payment). Phase 4 provisioning.
create unique index if not exists subscriptions_business_id_key
  on subscriptions (business_id);
