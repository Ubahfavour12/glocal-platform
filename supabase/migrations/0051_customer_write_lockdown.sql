-- What a signed-in customer may write, column by column.
--
-- THE HOLE. Row-level security on `businesses` says "you may touch your own
-- row", and that is all it says. It has never said WHICH COLUMNS. Supabase
-- grants every privilege on every public table to the `authenticated` role by
-- default, so the effective rule was: a customer may set any column of their
-- own business to anything. Including `plan`.
--
-- No part of the app does that. The settings route whitelists seven fields;
-- the subscription code writes `plan` with the service role after a verified
-- charge. But the app is not the only client. PostgREST publishes every table
-- at /rest/v1/<name>, the publishable key ships in the browser bundle by
-- design, and a customer's own session token is in their own cookie jar. One
-- request, no exploit, no tooling:
--
--     PATCH /rest/v1/businesses?id=eq.<mine>   {"plan": "scale"}
--
-- and the paid tier is free. The same request could clear `category_blocked`
-- (the manual compliance flag), reset `free_render_used` (each render costs us
-- real money at the vendor), or rewind `last_run_at`.
--
-- `approvals` had the same shape and a worse consequence: `payload` holds the
-- ad copy and the budgets the launcher sends to the ad network, AFTER the
-- compliance gateway has scanned them. A customer who could rewrite `payload`
-- and `status` directly could put unscanned copy in front of the launcher and
-- mark it approved, walking around the one gate the product calls mandatory.
--
-- THE FIX IS DENY-BY-DEFAULT, NOT A LONGER BLOCKLIST. Table-level write
-- privileges are revoked and only the columns the app actually writes with a
-- customer session are granted back. A trigger that rejected changes to a
-- list of protected columns would have worked today and failed silently the
-- day somebody added a new privileged column and forgot the list. With column
-- grants the failure mode is the safe one: a new column is unwritable by
-- customers until someone decides otherwise, and a forgotten grant fails
-- loudly in the settings page rather than quietly in the billing model.
--
-- RLS is unchanged and still does its half of the job: WHICH ROWS. This adds
-- the half that was missing.

-- ---------------------------------------------------------------------------
-- businesses
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on table businesses from anon, authenticated;

-- Exactly the columns onboarding sends. `plan`, `category_blocked` and
-- `free_render_used` are absent, so a new business is born on their defaults
-- and cannot be born on anything else.
grant insert (
  owner_id, name, category, goal, owner_role, service_geo,
  daily_budget_usd_minor, connection_mode, destination, country,
  founded_year, currency
) on table businesses to authenticated;

-- Exactly the columns the settings route and the strategy studio write.
-- `category` is deliberately not here: the restricted-vertical rules key off
-- it, and being able to relabel an alcohol business as a boutique after
-- onboarding would be a quieter way around the same gate.
grant update (
  daily_budget_usd_minor, goal, persona, full_auto,
  launch_hour, launch_timezone, ad_language, strategy_profile
) on table businesses to authenticated;

-- No DELETE. Erasure goes through `erase_business`, which knows about the
-- append-only tables; a bare delete from the browser never should have been
-- possible and nothing in the app issues one.

-- ---------------------------------------------------------------------------
-- approvals
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on table approvals from anon, authenticated;

-- The one thing a customer session writes directly: when to launch. Status
-- changes go through `respond_to_approval`, which validates the transition;
-- the payload is written only by the orchestrator, after the gateway.
grant update (scheduled_for) on table approvals to authenticated;

-- ---------------------------------------------------------------------------
-- social_connections / store_connections
-- ---------------------------------------------------------------------------
-- These hold page access tokens and a store's webhook secret. Both were
-- readable AND writable by the owning customer's browser session. Readable
-- means any script-injection bug anywhere in the app becomes token theft;
-- writable meant a customer could point `shop_domain` and `webhook_secret` at
-- values they chose and then sign their own "verified" store orders.
--
-- Every write to these tables already goes through the OAuth callbacks with
-- the service role, and every token read through a server job. The browser
-- needs to know a connection EXISTS and what it is called. Nothing more.
revoke all on table social_connections from anon, authenticated;
grant select (
  id, business_id, network, provider, status, display_name,
  platform_account_id, token_expires_at, created_at
) on table social_connections to authenticated;

revoke all on table store_connections from anon, authenticated;
grant select (
  id, business_id, provider, status, shop_domain, created_at
) on table store_connections to authenticated;

-- ---------------------------------------------------------------------------
-- A trigger function nobody should be able to name over the API
-- ---------------------------------------------------------------------------
-- Postgres refuses to run a trigger function outside a trigger, so this was
-- not exploitable. But it was SECURITY DEFINER and published at
-- /rest/v1/rpc/close_lead_for_conversion to anonymous callers, and "not
-- exploitable today" is a thin reason to leave a definer function on the
-- public API. Triggers check EXECUTE when they are created, not when they
-- fire, so revoking it changes nothing about the trigger itself.
revoke execute on function close_lead_for_conversion() from public, anon, authenticated;
