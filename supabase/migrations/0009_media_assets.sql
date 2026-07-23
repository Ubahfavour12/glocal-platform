-- 0009: product media storage (Phase 2.3). Source photos are STORED now,
-- because the render lane needs the actual image. Public bucket + an index
-- table scoped to the owner by RLS.

insert into storage.buckets (id, name, public)
  values ('product-media', 'product-media', true)
  on conflict (id) do nothing;

-- Anyone can read (ads/renders reference public URLs); only authenticated
-- users may upload, and only into the media bucket.
create policy "product-media public read" on storage.objects
  for select using (bucket_id = 'product-media');
create policy "product-media auth upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-media');

create table if not exists media_assets (
  id uuid primary key default uuid_generate_v4(),
  business_id uuid not null references businesses(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  kind text not null default 'image' check (kind in ('image', 'video')),
  created_at timestamptz not null default now()
);

alter table media_assets enable row level security;
create policy "own media_assets" on media_assets for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));
