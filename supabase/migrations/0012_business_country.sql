-- 0012: customer country for multi-currency display. USD stays canonical;
-- `currency` becomes the LOCAL display currency picked from country.
alter table businesses
  add column if not exists country text;
