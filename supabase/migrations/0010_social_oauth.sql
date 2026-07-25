-- 0010: social OAuth tokens on social_connections (self-serve "Connect socials").
-- The customer authorizes our app to post to THEIR page; we store the page
-- token (not their password), the account id, and expiry for auto-refresh.
alter table social_connections
  add column if not exists provider text not null default 'meta',
  add column if not exists platform_account_id text,
  add column if not exists display_name text,
  add column if not exists access_token text,
  add column if not exists token_expires_at timestamptz;

comment on column social_connections.access_token is
  'long-lived page/account token from OAuth; never the user password';
