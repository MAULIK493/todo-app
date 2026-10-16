\set ON_ERROR_STOP on
-- Error reports: stored safely, scrubbed, rate limited, unreadable through the API.
-- Relies on the test.* helpers created by 10_database.test.sql.

\set ue '''00000000-0000-0000-0000-0000000000e9'''

reset role;
insert into auth.users (id) values (:ue);
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e9', false);

select public.report_client_error('fp-1', 'TypeError: x is undefined', 'at foo (app.js:1:1)', '/w/:id/notes', '1.0.0', 'Chrome');
reset role;
select test.eq('report is stored', (select count(*) from public.client_errors where fingerprint = 'fp-1'), 1::bigint);
select test.eq('with the reporting user', (select user_id from public.client_errors where fingerprint = 'fp-1'), '00000000-0000-0000-0000-0000000000e9'::uuid);

set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e9', false);
select test.throws('reports cannot be read through the API', 'select * from public.client_errors');
select test.throws('nor written directly', $$insert into public.client_errors (fingerprint, message) values ('x', 'y')$$);
select test.throws('nor deleted', 'delete from public.client_errors');
select test.throws('purge is not available to users', 'select public.purge_client_errors(1)');
select test.throws('scrubbing helper is internal', $$select public.scrub_error_text('x')$$);

-- the same problem is recorded once per 10 minutes
select public.report_client_error('fp-1', 'again', null, null, null, null);
select public.report_client_error('fp-1', 'and again', null, null, null, null);
reset role;
select test.eq('duplicates are skipped', (select count(*) from public.client_errors where fingerprint = 'fp-1'), 1::bigint);

-- personal data is scrubbed on the server too
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e9', false);
select public.report_client_error('fp-pii',
  'Failed for jane.doe@example.com with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c key sk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef',
  'at https://app.example.com/a?email=bob@mail.org', '/w/abc?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk', '1.0.0', 'Firefox');
reset role;
select test.eq('emails removed', (select message !~ '@' and stack !~ '@' from public.client_errors where fingerprint = 'fp-pii'), true);
select test.eq('tokens and keys removed', (select message !~ 'eyJ' and message !~ 'sk_live' and route !~ 'eyJ' from public.client_errors where fingerprint = 'fp-pii'), true);
select test.eq('but the useful part stays', (select message from public.client_errors where fingerprint = 'fp-pii'), 'Failed for [email] with token [token] key [redacted]');

-- oversized input is cut, not rejected, so a huge crash still gets recorded
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e9', false);
select public.report_client_error('fp-big', repeat('x ', 2000), repeat('line ', 5000), repeat('/a', 400), repeat('9', 100), repeat('u', 1000), '{"a": 1}');
select public.report_client_error('fp-ctx', 'ctx', null, null, null, null, ('{"k": "' || repeat('v', 3000) || '"}')::jsonb);
reset role;
select test.eq('long fields are truncated', (select char_length(message) <= 600 and char_length(stack) <= 4000 and char_length(route) <= 200 and char_length(release) <= 40 and char_length(user_agent) <= 300 from public.client_errors where fingerprint = 'fp-big'), true);
select test.eq('oversized context is dropped', (select context from public.client_errors where fingerprint = 'fp-ctx'), '{}'::jsonb);

-- at most 30 per hour per user
set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e9', false);
do $$ begin for i in 1..60 loop perform public.report_client_error('flood-' || i, 'flood', null, null, null, null); end loop; end $$;
reset role;
select test.eq('flooding is capped', (select count(*) from public.client_errors where user_id = '00000000-0000-0000-0000-0000000000e9'), 30::bigint);

-- anonymous callers are ignored
set role anon; select set_config('request.jwt.claim.sub', '', false);
select test.throws('anonymous users cannot report', $$select public.report_client_error('anon', 'x')$$);
reset role;
select test.eq('and nothing from them is stored', (select count(*) from public.client_errors where fingerprint = 'anon'), 0::bigint);

-- housekeeping removes only old rows
update public.client_errors set created_at = now() - interval '45 days' where fingerprint in ('fp-big', 'fp-ctx');
select test.eq('purge deletes old reports only', public.purge_client_errors(30), 2);
select test.eq('recent reports survive', (select count(*) from public.client_errors where fingerprint = 'fp-1'), 1::bigint);

-- deleting the account keeps the report but drops the link to the person
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e9';
select test.eq('reports are kept anonymously after account deletion', (select count(*) from public.client_errors where fingerprint = 'fp-1' and user_id is null), 1::bigint);

\echo ALL TESTS PASSED
