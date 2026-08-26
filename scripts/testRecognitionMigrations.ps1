$ErrorActionPreference = 'Stop'

$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskDbDir = Join-Path $taskTempRoot ('nearr-recognition-pg-' + [guid]::NewGuid().ToString('N'))
$taskPort = Get-Random -Minimum 55000 -Maximum 55999
$env:PGCONNECT_TIMEOUT = '5'
New-Item -ItemType Directory -Path $taskDbDir | Out-Null

try {
  & "$pgBin\initdb.exe" -D $taskDbDir -A trust -U postgres --no-locale | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  & "$pgBin\pg_ctl.exe" -D $taskDbDir -l (Join-Path $taskDbDir 'server.log') -o "-p $taskPort" -w start
  if ($LASTEXITCODE -ne 0) { throw 'pg_ctl start failed' }

  $stubSql = @'
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create table public.places(
 id uuid primary key default gen_random_uuid(), google_place_id text unique, name text,
 formatted_address text, latitude numeric, longitude numeric, category text, google_maps_url text,
 short_formatted_address text, google_primary_type text, google_types text[], google_type_label text,
 business_status text
);
create table public.saved_places(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 place_id uuid not null references public.places(id), source_type text, source_url text, ai_note text,
 created_at timestamptz default now(), updated_at timestamptz default now(), unique(user_id,place_id)
);
create table public.share_jobs(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 source_url text not null, canonical_url text, source_platform text, status text,
 saved_place_id uuid references public.saved_places(id), progress_stage text, completed_at timestamptz,
 updated_at timestamptz default now()
);
create function public.correct_saved_place_provider(uuid,uuid,text,text,text,numeric,text)
returns table(saved_place_id uuid,merged_saved_place_id uuid,source_job_id uuid,source_result_id uuid,source_rule_version text)
language sql security definer as $$ select $1,null::uuid,null::uuid,null::uuid,null::text $$;
insert into auth.users values
 ('00000000-0000-0000-0000-000000000008'),
 ('00000000-0000-0000-0000-000000000009');
insert into public.places(id,google_place_id,name,latitude,longitude) values
 ('10000000-0000-0000-0000-000000000008','legacy-g8','Legacy YouTube',33.8,-117.8),
 ('10000000-0000-0000-0000-000000000009','legacy-g9','Legacy TikTok',33.9,-117.9);
insert into public.saved_places(id,user_id,place_id,source_type,source_url,ai_note,created_at) values
 ('20000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000008','youtube','https://youtu.be/dQw4w9WgXcQ?si=legacy','Legacy B','2026-08-01T00:00:00Z'),
 ('20000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000009','tiktok','https://www.tiktok.com/@legacy/video/7673607812571876630?utm_source=share','Legacy A','2026-08-02T00:00:00Z');
'@
  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -c $stubSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'stub apply failed' }

  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres `
    -f 'supabase\migrations\20260822000002_vayrin_recognition_cache_and_place_sources.sql' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'migration 02 failed' }
  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres `
    -f 'supabase\migrations\20260822000003_correct_saved_place_multi_source.sql' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'migration 03 failed' }
  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres `
    -f 'supabase\migrations\20260825000001_user_scoped_recognition_rejections.sql' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'recognition rejection migration failed' }

  $proofSql = @'
do $$ begin
 if (select count(*) from public.saved_place_sources where saved_place_id in (
   '20000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000009'
 )) <> 2 then raise exception 'legacy backfill count'; end if;
 if not exists (select 1 from public.saved_place_sources where identity_key='v1:tiktok:7673607812571876630')
   then raise exception 'tiktok backfill identity'; end if;
 if not exists (select 1 from public.saved_place_sources where identity_key='v1:youtube:dQw4w9WgXcQ')
   then raise exception 'youtube backfill identity'; end if;
 if has_table_privilege('authenticated','public.recognition_cache','select')
   or has_table_privilege('authenticated','public.recognition_inflight','insert')
   or has_table_privilege('authenticated','public.recognition_cache_events','select')
   then raise exception 'authenticated cache privilege leak'; end if;
 if not has_table_privilege('service_role','public.recognition_cache','select,insert,update,delete')
   then raise exception 'service role cache access missing'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000009',false);
do $$ begin
 if (select count(*) from public.saved_place_sources) <> 1
   then raise exception 'cross-user source leakage'; end if;
 begin
   perform * from public.attach_saved_place_source(
     '00000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000008',
     'v1:youtube:dQw4w9WgXcQ',1,'youtube','dQw4w9WgXcQ',
     'https://www.youtube.com/watch?v=dQw4w9WgXcQ',null,null,null,null,null,null
   );
   raise exception using errcode='P0002', message='unauthorized attach unexpectedly succeeded';
 exception when sqlstate 'P0001' then
   if sqlerrm <> 'not_owner' then raise; end if;
 end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',false);
insert into auth.users values ('00000000-0000-0000-0000-000000000001');
insert into public.places(id,google_place_id,name,latitude,longitude) values
 ('10000000-0000-0000-0000-000000000001','g1','Mad Yolks',33.1,-117.1);
insert into public.saved_places(id,user_id,place_id,source_type) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','manual');
select * from public.attach_saved_place_source(
 '00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 'v1:tiktok:111',1,'tiktok','111','https://www.tiktok.com/@a/video/111',null,'a',null,'A context','A note',null);
select * from public.attach_saved_place_source(
 '00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 'v1:tiktok:111',1,'tiktok','111','https://www.tiktok.com/@a/video/111','https://vm.tiktok.com/a',null,null,null,null,null);
select * from public.attach_saved_place_source(
 '00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
 'v1:youtube:abc1234',1,'youtube','abc1234','https://www.youtube.com/watch?v=abc1234',null,'b',null,'B context','B note',null);
insert into public.places(id,google_place_id,name,latitude,longitude) values
 ('10000000-0000-0000-0000-000000000002','g2','Corrected Place',33.2,-117.2);
insert into public.recognition_cache(
 identity_key,platform,content_id,canonical_url,identity_version,recognition_version,
 result_type,trust_level,canonical_place_id
) values (
 'v1:tiktok:111','tiktok','111','https://www.tiktok.com/@a/video/111',1,'test-v1',
 'verified_place','VERIFIED_AUTO_SAVE','10000000-0000-0000-0000-000000000001'
);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
update public.saved_places set place_id='10000000-0000-0000-0000-000000000002'
 where id='20000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub','',false);
do $$ begin
 if (select count(*) from public.saved_places where user_id='00000000-0000-0000-0000-000000000001') <> 1 then raise exception 'saved count'; end if;
 if (select count(*) from public.saved_place_sources where saved_place_id='20000000-0000-0000-0000-000000000001') <> 2 then raise exception 'source count'; end if;
 if (select count(*) from public.saved_place_sources where saved_place_id='20000000-0000-0000-0000-000000000001' and is_primary) <> 1 then raise exception 'primary count'; end if;
 if (select caption_excerpt from public.saved_place_sources where identity_key='v1:tiktok:111') <> 'A context' then raise exception 'source A context overwritten'; end if;
 if (select ai_note from public.saved_place_sources where identity_key='v1:tiktok:111') <> 'A note' then raise exception 'source A note overwritten'; end if;
 if (select caption_excerpt from public.saved_place_sources where identity_key='v1:youtube:abc1234') <> 'B context' then raise exception 'source B context missing'; end if;
 if not (select claimed from public.claim_recognition_identity('v1:tiktok:111','30000000-0000-0000-0000-000000000001',60)) then raise exception 'first claim'; end if;
 if (select claimed from public.claim_recognition_identity('v1:tiktok:111','30000000-0000-0000-0000-000000000002',60)) then raise exception 'duplicate claim'; end if;
 if (select canonical_place_id from public.recognition_cache where identity_key='v1:tiktok:111') <>
   '10000000-0000-0000-0000-000000000001'::uuid then raise exception 'correction rewrote global truth'; end if;
 if (select invalidation_reason from public.recognition_cache where identity_key='v1:tiktok:111') is not null
   then raise exception 'one correction globally invalidated truth'; end if;
 if not exists (
   select 1 from public.recognition_rejections
    where user_id='00000000-0000-0000-0000-000000000001'
      and identity_key='v1:tiktok:111'
      and canonical_place_id='10000000-0000-0000-0000-000000000001'
      and reason='corrected_place'
 ) then raise exception 'user-scoped correction rejection missing'; end if;
end $$;
update public.recognition_inflight set lease_expires_at=now()-interval '1 second'
 where identity_key='v1:tiktok:111';
do $$ begin
 if not (select claimed from public.claim_recognition_identity(
   'v1:tiktok:111','30000000-0000-0000-0000-000000000003',60
 )) then raise exception 'stale lease recovery'; end if;
 if not public.release_recognition_identity(
   'v1:tiktok:111','30000000-0000-0000-0000-000000000003'
 ) then raise exception 'owner release'; end if;
 if public.release_recognition_identity(
   'v1:tiktok:111','30000000-0000-0000-0000-000000000003'
 ) then raise exception 'release not idempotent'; end if;
end $$;
insert into public.recognition_cache(
 identity_key,platform,content_id,canonical_url,identity_version,recognition_version,
 result_type,trust_level,canonical_place_id,candidate_payload,invalidated_at,invalidation_reason
) values (
 'v1:tiktok:111','tiktok','111','https://www.tiktok.com/@a/video/111',1,'test-v1',
 'verified_place','VERIFIED_AUTO_SAVE','10000000-0000-0000-0000-000000000002',
 jsonb_build_object('candidates',jsonb_build_array(jsonb_build_object('googlePlaceId','g2'))),null,null
) on conflict (identity_key) do update set
 result_type=excluded.result_type,trust_level=excluded.trust_level,
 canonical_place_id=excluded.canonical_place_id,candidate_payload=excluded.candidate_payload,
 invalidated_at=null,invalidation_reason=null;
do $$ begin
 if (select trust_level from public.recognition_cache where identity_key='v1:tiktok:111') <>
   'VERIFIED_AUTO_SAVE' then raise exception 'user dispute poisoned global machine truth'; end if;
 if (select canonical_place_id from public.recognition_cache where identity_key='v1:tiktok:111') <>
   '10000000-0000-0000-0000-000000000002'::uuid
   then raise exception 'global truth update failed'; end if;
end $$;
update public.recognition_cache set
 result_type='verified_place',trust_level='USER_CONFIRMED',
 canonical_place_id='10000000-0000-0000-0000-000000000002',
 confirmation_count=confirmation_count+1,confirmed_at=now()
 where identity_key='v1:tiktok:111';
do $$ begin
 if (select trust_level from public.recognition_cache where identity_key='v1:tiktok:111') <>
   'USER_CONFIRMED' then raise exception 'human confirmation promotion'; end if;
end $$;
select 'MIGRATION_DRY_RUN_PASS' as result,
 (select count(*) from public.saved_places) as saved_place_count,
 (select count(*) from public.saved_place_sources) as source_count,
 (select count(*) from public.saved_place_sources where is_primary) as primary_count,
 (select string_agg(caption_excerpt, ' + ' order by identity_key) from public.saved_place_sources) as preserved_contexts;
'@
  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -c $proofSql
  if ($LASTEXITCODE -ne 0) { throw 'proof failed' }
} finally {
  & "$pgBin\pg_ctl.exe" -D $taskDbDir -m fast -w stop 2>$null
  $resolved = [IO.Path]::GetFullPath($taskDbDir)
  if (
    $resolved.StartsWith($taskTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
    (Split-Path $resolved -Leaf).StartsWith('nearr-recognition-pg-')
  ) {
    [IO.Directory]::Delete($resolved, $true)
  }
}
