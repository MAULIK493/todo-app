\set ON_ERROR_STOP on
-- Custom background uploads: each user is confined to their own folder in the private bucket.
-- Relies on the test.* helpers created by 10_database.test.sql.

\set ua '''00000000-0000-0000-0000-0000000000a8'''
\set ub '''00000000-0000-0000-0000-0000000000b8'''

reset role;
insert into auth.users (id) values (:ua), (:ub);
select test.eq('bucket is private with limits', (select not public and file_size_limit = 15728640 and 'video/mp4' = any (allowed_mime_types) and not 'image/svg+xml' = any (allowed_mime_types) from storage.buckets where id = 'backgrounds'), true);

set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', false);
insert into storage.objects (bucket_id, name) values ('backgrounds', '00000000-0000-0000-0000-0000000000a8/mine.webp');
select test.eq('can upload into own folder', (select count(*) from storage.objects), 1::bigint);
select test.throws('cannot upload into someone else''s folder', $$insert into storage.objects (bucket_id, name) values ('backgrounds', '00000000-0000-0000-0000-0000000000b8/hijack.webp')$$);
select test.throws('cannot upload at the bucket root', $$insert into storage.objects (bucket_id, name) values ('backgrounds', 'loose.webp')$$);
select test.throws('cannot sneak into another folder with a lookalike path', $$insert into storage.objects (bucket_id, name) values ('backgrounds', 'x/00000000-0000-0000-0000-0000000000b8/a.webp')$$);
select test.throws('cannot write to other buckets', $$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-0000000000a8/a.webp')$$);

reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b8', false);
select test.eq('another user cannot see the file', (select count(*) from storage.objects), 0::bigint);
update storage.objects set name = '00000000-0000-0000-0000-0000000000b8/stolen.webp';
delete from storage.objects;
reset role;
select test.eq('and cannot rename or delete it', (select name from storage.objects), '00000000-0000-0000-0000-0000000000a8/mine.webp');

set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', false);
select test.throws('owner cannot move a file into another folder', $$update storage.objects set name = '00000000-0000-0000-0000-0000000000b8/moved.webp'$$);
update storage.objects set name = '00000000-0000-0000-0000-0000000000a8/renamed.webp';
select test.eq('owner can rename within their folder', (select name from storage.objects), '00000000-0000-0000-0000-0000000000a8/renamed.webp');
delete from storage.objects;
select test.eq('owner can delete their own file', (select count(*) from storage.objects), 0::bigint);

\echo ALL TESTS PASSED
