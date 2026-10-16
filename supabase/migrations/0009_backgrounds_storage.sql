-- Phase 8: private storage for custom backgrounds (images and short videos users upload themselves).
--
-- Each user may only touch files inside their own folder (<user id>/<file>). The bucket is private, so files are
-- only reachable through short-lived signed links the owner asks for. The bucket also limits the size and type of
-- every upload on the server, whatever the browser claims.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'backgrounds', 'backgrounds', false, 15728640,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
)
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "backgrounds: read own files" on storage.objects for select to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "backgrounds: upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "backgrounds: replace own files" on storage.objects for update to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "backgrounds: delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);
