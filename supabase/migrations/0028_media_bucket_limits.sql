-- Make the upload rules real rather than polite.
--
-- `validateUpload` runs in the BROWSER, because uploads go straight from the
-- customer's device to Supabase Storage. That check is a courtesy: it gives an
-- immediate, friendly refusal. It is not enforcement, because anyone can call
-- the storage API directly with their own session and skip it entirely.
--
-- These are the limits that actually hold, applied by the storage service:
--
--  * allowed_mime_types — the bucket refuses anything else, whatever the client
--    says. Note what is NOT on the list: image/svg+xml. An SVG is an image that
--    can contain a <script>, and this bucket is public, so allowing it would be
--    stored XSS served from our own domain.
--  * file_size_limit — 200MB, the video cap. Nothing previously stopped one
--    customer uploading a 4GB file, repeatedly.
--
-- Also tightens the insert policy. It read:
--
--     with check (bucket_id = 'product-media')
--
-- which let ANY authenticated user write anywhere in the bucket, including
-- into another business's folder. Paths are `${businessId}/...`, so scoping the
-- policy to a folder the caller actually owns costs nothing and closes it.

update storage.buckets
set
  file_size_limit = 209715200, -- 200MB
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
where id = 'product-media';

drop policy if exists "product-media auth upload" on storage.objects;

create policy "product-media own folder upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-media'
    -- First path segment is the business id. The caller must own that business.
    and (storage.foldername(name))[1] in (
      select id::text from businesses where owner_id = auth.uid()
    )
  );

-- Deleting is already routed through deleteProductMedia, but the same scoping
-- should hold: without it an authenticated user could remove another
-- business's product photos.
drop policy if exists "product-media own folder delete" on storage.objects;

create policy "product-media own folder delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-media'
    and (storage.foldername(name))[1] in (
      select id::text from businesses where owner_id = auth.uid()
    )
  );
