-- 0013: Shopify store-connect OAuth tokens on store_connections (Phase 3).
alter table store_connections
  add column if not exists shop_domain text,
  add column if not exists access_token text;

-- One store per business (lets the callback upsert on reconnect).
create unique index if not exists store_connections_business_id_key
  on store_connections (business_id);
