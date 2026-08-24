$ErrorActionPreference = 'Stop'

$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskDbDir = Join-Path $taskTempRoot ('nearr-empty-queue-pg-' + [guid]::NewGuid().ToString('N'))
$taskPort = Get-Random -Minimum 56000 -Maximum 56999
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

create table public.share_jobs(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_url text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.share_job_place_results(
  id uuid primary key default gen_random_uuid(),
  share_job_id uuid not null references public.share_jobs(id),
  user_id uuid not null references auth.users(id),
  origin text not null,
  outcome text not null,
  finalized_at timestamptz
);
create table public.saved_places(id uuid primary key, user_id uuid not null, notes text);
create table public.saved_place_sources(id uuid primary key, saved_place_id uuid not null, source_url text);
create table public.recognition_cache(id uuid primary key, identity_key text not null);
create table public.share_media_tasks(id uuid primary key, share_job_id uuid not null, status text);
create table public.share_media_runs(id uuid primary key, share_job_id uuid not null, provider_cost numeric);

alter table public.share_jobs enable row level security;
create policy share_jobs_owner_select on public.share_jobs for select using (auth.uid() = user_id);
create policy share_jobs_owner_delete on public.share_jobs for delete using (auth.uid() = user_id);
grant select, delete on public.share_jobs to authenticated;
grant select, insert, update, delete on public.share_jobs to service_role;

insert into auth.users values
 ('00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000002');
'@
  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -c $stubSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'stub apply failed' }

  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres `
    -f 'supabase\migrations\20260824233000_empty_queue_durable.sql' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'empty-queue migration apply failed' }

  $proofSql = @'
insert into public.share_jobs(id,user_id,source_url,status,created_at) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','https://example.com/q','queued',now()-interval '5 minutes'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','https://example.com/p','processing_metadata',now()-interval '4 minutes'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','https://example.com/n','needs_help',now()-interval '3 minutes'),
 ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','https://example.com/f','failed',now()-interval '2 minutes'),
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','https://example.com/c','completed',now()-interval '1 minute'),
 ('10000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000001','https://example.com/old','completed',now()-interval '3 days'),
 ('10000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','https://example.com/future','queued',now()+interval '10 minutes'),
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','https://example.com/b','queued',now()-interval '1 minute');
insert into public.share_job_place_results values
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','automatic','auto_saved',now()-interval '30 seconds');
insert into public.saved_places values ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','keep');
insert into public.saved_place_sources values ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','https://example.com/original');
insert into public.recognition_cache values ('60000000-0000-0000-0000-000000000001','v1:test:keep');
insert into public.share_media_tasks values ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','processing');
insert into public.share_media_runs values ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1.25);

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$
declare r record;
begin
  select * into r from public.archive_active_queue_for_user();
  if r.archived_count <> 5 then raise exception 'expected 5 archived, got %', r.archived_count; end if;
  if (select count(*) from public.share_jobs where queue_archived_at is null and status in ('queued','processing_metadata','needs_help','failed')) <> 1
    then raise exception 'new item after cutoff was not preserved'; end if;
  if (select count(*) from public.share_jobs where id='20000000-0000-0000-0000-000000000001' and queue_archived_at is null) <> 0
    then raise exception 'cross-account visibility leak'; end if;
end $$;

do $$ begin
  begin
    delete from public.share_jobs where id='10000000-0000-0000-0000-000000000001';
    raise exception using errcode='P0002', message='hard delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

do $$
declare r record;
begin
  select * into r from public.archive_active_queue_for_user(array['20000000-0000-0000-0000-000000000001'::uuid]);
  if r.archived_count <> 0 then raise exception 'user A archived user B'; end if;
  select * into r from public.archive_active_queue_for_user();
  if r.archived_count <> 0 then raise exception 'operation is not idempotent'; end if;
end $$;
reset role;

-- A worker completion updates lifecycle columns but cannot resurrect archival.
update public.share_jobs set status='completed', updated_at=now()
 where id='10000000-0000-0000-0000-000000000002';
do $$ begin
  if (select queue_archived_at from public.share_jobs where id='10000000-0000-0000-0000-000000000002') is null
    then raise exception 'worker completion resurrected archived job'; end if;
  if (select count(*) from public.share_jobs) <> 8 then raise exception 'share job history was deleted'; end if;
  if (select count(*) from public.share_job_place_results) <> 1 then raise exception 'result history was deleted'; end if;
  if (select count(*) from public.saved_places) <> 1 then raise exception 'saved place changed'; end if;
  if (select count(*) from public.saved_place_sources) <> 1 then raise exception 'saved place source changed'; end if;
  if (select count(*) from public.recognition_cache) <> 1 then raise exception 'recognition cache changed'; end if;
  if (select count(*) from public.share_media_tasks) <> 1 then raise exception 'media task history changed'; end if;
  if (select sum(provider_cost) from public.share_media_runs) <> 1.25 then raise exception 'cost history changed'; end if;
end $$;

-- Per-item removal uses the same RPC, and a newly-created post appears normally.
update public.share_jobs set created_at=now() where id='10000000-0000-0000-0000-000000000007';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare r record; begin
  select * into r from public.archive_active_queue_for_user(array['10000000-0000-0000-0000-000000000007'::uuid]);
  if r.archived_count <> 1 then raise exception 'per-item archive mismatch'; end if;
end $$;
reset role;

-- A fresh authenticated session/device sees the same server-authoritative empty queue.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
  if (select count(*) from public.share_jobs
       where queue_archived_at is null
         and status in ('queued','processing_metadata','needs_help','failed')) <> 0
    then raise exception 'server refetch resurrected an archived queue row'; end if;
end $$;
reset role;

-- Set-based performance guards at representative queue sizes.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$
declare
  queue_size integer;
  started timestamptz;
  r record;
  elapsed_ms numeric;
begin
  foreach queue_size in array array[10,100,1000,5000] loop
    insert into public.share_jobs(user_id,source_url,status,created_at)
    select '00000000-0000-0000-0000-000000000001',
           'https://example.com/load/'||queue_size||'/'||g, 'queued', now()
      from generate_series(1,queue_size) g;
    started := clock_timestamp();
    select * into r from public.archive_active_queue_for_user();
    elapsed_ms := extract(epoch from clock_timestamp()-started)*1000;
    if r.archived_count <> queue_size then
      raise exception 'expected % archived, got %', queue_size, r.archived_count;
    end if;
    if elapsed_ms > 5000 then
      raise exception '%-row archive too slow: % ms', queue_size, elapsed_ms;
    end if;
    raise notice 'EMPTY_QUEUE_PERF_%_MS=%', queue_size, round(elapsed_ms,2);
  end loop;
end $$;

do $$ begin
  if has_function_privilege('anon','public.archive_active_queue_for_user(uuid[])','execute')
    then raise exception 'anonymous execute privilege leaked'; end if;
  if not has_function_privilege('authenticated','public.archive_active_queue_for_user(uuid[])','execute')
    then raise exception 'authenticated execute missing'; end if;
end $$;
select 'EMPTY_QUEUE_MIGRATION_PASS' as result;
'@
  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -c $proofSql
  if ($LASTEXITCODE -ne 0) { throw 'empty-queue SQL proof failed' }
} finally {
  & "$pgBin\pg_ctl.exe" -D $taskDbDir -m fast -w stop 2>$null | Out-Null
  $resolved = [IO.Path]::GetFullPath($taskDbDir)
  if (
    $resolved.StartsWith($taskTempRoot, [StringComparison]::OrdinalIgnoreCase) -and
    (Split-Path $resolved -Leaf).StartsWith('nearr-empty-queue-pg-')
  ) {
    [IO.Directory]::Delete($resolved, $true)
  }
}
