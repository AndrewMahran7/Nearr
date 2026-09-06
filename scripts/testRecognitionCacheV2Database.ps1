$ErrorActionPreference = 'Stop'

$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$taskTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$taskDbDir = Join-Path $taskTempRoot ('nearr-cache-v2-pg-' + [guid]::NewGuid().ToString('N'))
$taskPort = Get-Random -Minimum 56000 -Maximum 56999
$env:PGCONNECT_TIMEOUT = '5'
New-Item -ItemType Directory -Path $taskDbDir | Out-Null

function Invoke-LocalPsql([string]$Sql) {
  $sqlPath = Join-Path $taskDbDir ('assert-' + [guid]::NewGuid().ToString('N') + '.sql')
  [IO.File]::WriteAllText($sqlPath,$Sql,[Text.UTF8Encoding]::new($false))
  try {
    & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f $sqlPath
    if ($LASTEXITCODE -ne 0) { throw 'psql assertion failed' }
  } finally {
    if ([IO.File]::Exists($sqlPath)) { [IO.File]::Delete($sqlPath) }
  }
}

function Start-LocalPsqlJob([string]$Sql) {
  Start-Job -ScriptBlock {
    param($Psql, $Port, $Statement)
    $output = & $Psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $Port -U postgres -d postgres -c $Statement 2>&1
    [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
  } -ArgumentList "$pgBin\psql.exe", $taskPort, $Sql
}

try {
  & "$pgBin\initdb.exe" -D $taskDbDir -A trust -U postgres --no-locale | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  & "$pgBin\pg_ctl.exe" -D $taskDbDir -l (Join-Path $taskDbDir 'server.log') -o "-p $taskPort" -w start
  if ($LASTEXITCODE -ne 0) { throw 'pg_ctl start failed' }

  $baselineSql = @'
create extension if not exists pgcrypto;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;

create table public.places(
  id uuid primary key default gen_random_uuid(),google_place_id text unique not null,name text not null,
  formatted_address text,latitude numeric,longitude numeric,category text,google_maps_url text,
  short_formatted_address text,google_primary_type text,google_types text[],google_type_label text,
  business_status text,merged_into uuid references public.places(id)
);
create function public.resolve_public_place_id(p_public_id uuid) returns uuid language sql stable as $$
  with recursive chain(id,merged_into,depth) as (
    select p.id,p.merged_into,0 from public.places p where p.id=p_public_id
    union all select p.id,p.merged_into,c.depth+1 from chain c join public.places p on p.id=c.merged_into where c.depth<10
  ) select id from chain order by depth desc limit 1
$$;

create table public.saved_places(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references public.places(id),source_type text,source_url text,notes text,ai_note text,
  category text,category_source text,category_confidence numeric,category_model_version text,
  category_user_overridden boolean not null default false,categorized_at timestamptz,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(user_id,place_id)
);
create table public.share_jobs(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null,canonical_url text,source_platform text,status text,saved_place_id uuid references public.saved_places(id),
  progress_stage text,completed_at timestamptz,updated_at timestamptz default now(),decision text,
  candidate_payload jsonb,extraction_payload jsonb,recognition_identity_key text,
  recognition_identity_version integer,recognition_content_id text,failure_category text,failure_code text,
  premium_request_id uuid
);
create table public.share_media_tasks(
  id uuid primary key default gen_random_uuid(),share_job_id uuid references public.share_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,source_url text not null,canonical_url text,
  platform text not null,status text not null default 'queued',progress_stage text,attempts integer not null default 0,
  max_attempts integer not null default 3,locked_at timestamptz,locked_until timestamptz,next_attempt_at timestamptz default now(),
  resolver_name text,media_duration_seconds numeric,media_size_bytes bigint,media_sha256 text,
  transcription_provider text,analysis_provider text,failure_code text,failure_detail text,warnings jsonb default '[]',
  created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz,
  task_kind text not null default 'recognition',saved_place_id uuid references public.saved_places(id),
  target_place_id uuid references public.places(id),retry_cycles integer default 0,evidence_snapshot jsonb default '[]',
  media_acquired_once boolean default false,frame_snapshot bytea,frame_snapshot_timestamp_seconds double precision,
  analysis_model text,prompt_version text,latency_ms integer,model_calls integer,model_input_tokens integer,
  model_output_tokens integer,model_thinking_tokens integer,model_latency_ms integer,ai_note_outcome text,
  premium_request_id uuid,
  constraint share_media_tasks_task_kind_check check(task_kind in ('recognition','premium_recognition','ai_note_enrichment')),
  constraint share_media_tasks_target_check check(
    (task_kind in ('recognition','premium_recognition') and share_job_id is not null and saved_place_id is null and target_place_id is null)
    or (task_kind='ai_note_enrichment' and share_job_id is null and saved_place_id is not null and target_place_id is not null)),
  constraint share_media_tasks_premium_identity_check check(
    (task_kind='premium_recognition' and premium_request_id is not null) or (task_kind<>'premium_recognition' and premium_request_id is null))
);
create function public.is_video_derived_saved_place(text,text) returns boolean language sql stable as $$ select true $$;
create function public.expire_media_tasks(p_limit integer default 25)
returns setof public.share_media_tasks language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query update public.share_media_tasks mt set status='failed',
    failure_code=coalesce(mt.failure_code,'media_worker_unavailable'),locked_until=null,
    completed_at=now(),updated_at=now()
  where mt.id in (select c.id from public.share_media_tasks c
    where c.status in ('queued','processing') and c.attempts>=c.max_attempts
      and (c.locked_until is null or c.locked_until<now())
    order by c.updated_at for update skip locked limit greatest(p_limit,1))
  returning mt.*;
end $$;

create table public.share_job_place_results(
  id uuid primary key default gen_random_uuid(),share_job_id uuid not null references public.share_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,logical_result_id text not null,
  google_place_id text,place_id uuid references public.places(id),saved_place_id uuid references public.saved_places(id),
  outcome text not null,origin text not null,confidence_score numeric,rule_version text not null,
  reason_codes jsonb not null default '[]',result_role text,candidate_rank smallint,candidate_snapshot jsonb,
  created_at timestamptz default now(),updated_at timestamptz default now(),finalized_at timestamptz,
  unique(share_job_id,logical_result_id)
);

create table public.saved_place_sources(
  id uuid primary key default gen_random_uuid(),saved_place_id uuid not null references public.saved_places(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,identity_key text not null,identity_version integer not null,
  platform text not null,content_id text not null,canonical_url text not null,original_url text,creator_handle text,
  creator_name text,caption_excerpt text,ai_note text,thumbnail_url text,is_primary boolean not null default false,
  first_attached_at timestamptz default now(),last_seen_at timestamptz default now(),created_at timestamptz default now(),
  updated_at timestamptz default now(),unique(saved_place_id,identity_key)
);
create function public.attach_saved_place_source(
  p_user_id uuid,p_saved_place_id uuid,p_identity_key text,p_identity_version integer,p_platform text,
  p_content_id text,p_canonical_url text,p_original_url text,p_creator_handle text,p_creator_name text,
  p_caption_excerpt text,p_ai_note text,p_thumbnail_url text
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if not exists(select 1 from public.saved_places where id=p_saved_place_id and user_id=p_user_id) then raise exception 'not_owner'; end if;
  insert into public.saved_place_sources(saved_place_id,user_id,identity_key,identity_version,platform,content_id,
    canonical_url,original_url,creator_handle,creator_name,caption_excerpt,ai_note,thumbnail_url,is_primary)
  values(p_saved_place_id,p_user_id,p_identity_key,p_identity_version,p_platform,p_content_id,p_canonical_url,
    p_original_url,p_creator_handle,p_creator_name,p_caption_excerpt,p_ai_note,p_thumbnail_url,
    not exists(select 1 from public.saved_place_sources where saved_place_id=p_saved_place_id))
  on conflict(saved_place_id,identity_key) do update set last_seen_at=now(),ai_note=coalesce(excluded.ai_note,public.saved_place_sources.ai_note)
  returning id into v_id;
  return v_id;
end $$;

create table public.recognition_cache(
  id uuid primary key default gen_random_uuid(),identity_key text unique not null,platform text not null,content_id text not null,
  canonical_url text not null,identity_version integer not null,recognition_version text not null,result_type text not null,
  trust_level text not null,canonical_place_id uuid references public.places(id),candidate_payload jsonb,evidence_summary jsonb,
  confirmation_count integer default 0,dispute_count integer default 0,first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),last_verified_at timestamptz,confirmed_at timestamptz,invalidated_at timestamptz,
  invalidation_reason text,created_at timestamptz default now(),updated_at timestamptz default now()
);
create function public.recognition_cache_preserve_trust() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger recognition_cache_trust_guard before update on public.recognition_cache for each row execute function public.recognition_cache_preserve_trust();
create table public.recognition_cache_events(
  id bigint generated always as identity primary key,event_name text not null,
  identity_key text,platform text,media_download_avoided boolean default false,gemini_calls_avoided integer default 0,
  sol_calls_avoided integer default 0,estimated_latency_ms_saved integer default 0,detail jsonb default '{}',created_at timestamptz default now(),
  constraint recognition_cache_events_event_name_check check(event_name in ('recognition_cache_hit','recognition_cache_miss'))
);
create table public.recognition_rejections(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
  identity_key text not null,identity_version integer not null,canonical_place_id uuid not null references public.places(id),
  google_place_id text,source_saved_place_id uuid,reason text,rejected_at timestamptz default now(),created_at timestamptz default now(),
  updated_at timestamptz default now(),unique(user_id,identity_key,canonical_place_id)
);

create function public.dispute_recognition_after_place_correction() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger saved_places_dispute_recognition_after_correction after update of place_id on public.saved_places
  for each row execute function public.dispute_recognition_after_place_correction();
create function public.correct_saved_place_provider(uuid,uuid,text,text,text,numeric,text)
returns table(saved_place_id uuid,merged_saved_place_id uuid,source_job_id uuid,source_result_id uuid,source_rule_version text)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if not exists(select 1 from public.saved_places sp where sp.id=$1 and sp.user_id=auth.uid()) then raise exception 'not_owner'; end if;
  update public.saved_places set place_id=$2,updated_at=now() where id=$1;
  return query select $1,null::uuid,null::uuid,null::uuid,'test-rule'::text;
end $$;
'@
  Invoke-LocalPsql $baselineSql | Out-Null
  Write-Host 'DB_V2_STAGE baseline_ready'

  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres `
    -f 'supabase\migrations\20260906000004_recognition_cache_v2.sql' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Recognition Cache V2 migration failed' }
  Write-Host 'DB_V2_STAGE migration_applied'

  $fixtureSql = @'
insert into auth.users(id) select ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid from generate_series(1,8)i;
insert into public.places(id,google_place_id,name,latitude,longitude,category) values
 ('10000000-0000-0000-0000-000000000001','g-a','Place A',33.1,-117.1,'restaurant'),
 ('10000000-0000-0000-0000-000000000002','g-b','Place B',33.2,-117.2,'restaurant'),
 ('10000000-0000-0000-0000-000000000003','g-c','Place C',33.3,-117.3,'restaurant'),
 ('10000000-0000-0000-0000-000000000004','g-sibling','Sibling',33.4,-117.4,'park'),
 ('10000000-0000-0000-0000-000000000005','g-parent','Broad Parent',33.5,-117.5,'establishment');
insert into public.saved_places(id,user_id,place_id,source_type,source_url,notes,ai_note) values
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','tiktok','https://www.tiktok.com/@proof/video/111','PRIVATE USER NOTE','Source-grounded AI note'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','tiktok','https://www.tiktok.com/@proof/video/111',null,'Sibling note');
select public.attach_saved_place_source('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','v1:tiktok:111',1,'tiktok','111','https://www.tiktok.com/@proof/video/111',null,null,null,'caption','Source-grounded AI note',null);
select public.attach_saved_place_source('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','v1:tiktok:111',1,'tiktok','111','https://www.tiktok.com/@proof/video/111',null,null,null,'caption','Sibling note',null);
insert into public.share_jobs(id,user_id,source_url,canonical_url,source_platform,status,saved_place_id,decision,
 recognition_identity_key,recognition_identity_version,recognition_content_id)
values('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
 'https://www.tiktok.com/@proof/video/111','https://www.tiktok.com/@proof/video/111','tiktok','processing_metadata',
 '20000000-0000-0000-0000-000000000001','auto_save','v1:tiktok:111',1,'111');
insert into public.share_job_place_results(share_job_id,user_id,logical_result_id,google_place_id,place_id,saved_place_id,
 outcome,origin,confidence_score,rule_version,reason_codes,result_role,candidate_snapshot) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','slot-d1','g-a','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','auto_saved','automatic',0.95,'test','[]','primary','{"googlePlaceId":"g-a"}'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','slot-d2','g-sibling','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','auto_saved','automatic',0.94,'test','[]','primary','{"googlePlaceId":"g-sibling"}');
insert into public.share_media_tasks(id,share_job_id,user_id,source_url,canonical_url,platform,status,task_kind,
 media_sha256,media_acquired_once) values('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
 '00000000-0000-0000-0000-000000000001','https://www.tiktok.com/@proof/video/111','https://www.tiktok.com/@proof/video/111','tiktok','processing','recognition','sha-proof-111',true);
update public.share_jobs set status='completed',completed_at=now() where id='30000000-0000-0000-0000-000000000001';
update public.share_media_tasks set status='completed',completed_at=now() where id='40000000-0000-0000-0000-000000000001';
do $$ begin
 if (select count(*) from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:111' and state='ELIGIBLE')<>2 then raise exception 'admission failed'; end if;
 if (select source_ai_note from public.recognition_source_states where identity_key='v1:tiktok:111')<>'Source-grounded AI note' then raise exception 'source AI note missing'; end if;
 if exists(select 1 from public.recognition_source_states where source_ai_note='PRIVATE USER NOTE') then raise exception 'private note leaked'; end if;
end $$;

-- Weak personal auto-save and a partial multi-slot result stay ineligible.
insert into public.saved_places(id,user_id,place_id,source_type,source_url) values
 ('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000003','tiktok','https://www.tiktok.com/@proof/video/222');
select public.attach_saved_place_source('00000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000003','v1:tiktok:222',1,'tiktok','222','https://www.tiktok.com/@proof/video/222',null,null,null,null,null,null);
insert into public.share_jobs(id,user_id,source_url,canonical_url,source_platform,status,saved_place_id,decision,recognition_identity_key,recognition_identity_version,recognition_content_id)
values('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000008','https://www.tiktok.com/@proof/video/222','https://www.tiktok.com/@proof/video/222','tiktok','completed','20000000-0000-0000-0000-000000000003','auto_save','v1:tiktok:222',1,'222');
insert into public.share_job_place_results(share_job_id,user_id,logical_result_id,google_place_id,place_id,saved_place_id,outcome,origin,confidence_score,rule_version,reason_codes,result_role)
values('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000008','weak','g-c','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','auto_saved','automatic',0.70,'test','[]','primary');
insert into public.share_media_tasks(id,share_job_id,user_id,source_url,canonical_url,platform,status,task_kind,media_sha256,media_acquired_once)
values('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000008','https://www.tiktok.com/@proof/video/222','https://www.tiktok.com/@proof/video/222','tiktok','processing','recognition','sha-proof-222',true);
update public.share_media_tasks set status='completed',completed_at=now() where id='40000000-0000-0000-0000-000000000002';
do $$ begin if exists(select 1 from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:222') then raise exception 'weak result admitted'; end if; end $$;

-- Owner correction commits the personal map change, event, revision,
-- quarantine, current support, and durable work in one transaction.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select * from public.correct_saved_place_provider_v2('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','g-b','restaurant','test',1,'test','correction-proof-111');
select set_config('request.jwt.claim.sub','',false);
do $$ begin
 if (select place_id from public.saved_places where id='20000000-0000-0000-0000-000000000001')<>'10000000-0000-0000-0000-000000000002' then raise exception 'personal correction missing'; end if;
 if (select state from public.recognition_source_states where identity_key='v1:tiktok:111')<>'QUARANTINED' then raise exception 'source not quarantined'; end if;
 if (select state from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:111' and slot_key='slot-d1')<>'QUARANTINED' then raise exception 'slot not quarantined'; end if;
 if (select state from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:111' and slot_key='slot-d2')<>'ELIGIBLE' then raise exception 'sibling changed'; end if;
 if (select count(*) from public.recognition_correction_events where identity_key='v1:tiktok:111')<>1 then raise exception 'event missing'; end if;
 if (select count(*) from public.recognition_revalidation_tasks where identity_key='v1:tiktok:111')<>1 then raise exception 'task missing'; end if;
end $$;

-- Idempotent replay of the same current correction creates no new history/work.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select * from public.correct_saved_place_provider_v2('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','g-b','restaurant','test',1,'test','correction-proof-111');
select set_config('request.jwt.claim.sub','',false);
do $$ begin if (select count(*) from public.recognition_correction_events where identity_key='v1:tiktok:111')<>1 then raise exception 'duplicate event'; end if; end $$;

-- Fresh independent model agreement validates replacement B; sibling survives.
select * from public.claim_media_tasks(1,60);
select public.complete_recognition_revalidation_v2(
 (select id from public.recognition_revalidation_tasks where identity_key='v1:tiktok:111'),
 'AGREES_WITH_REPLACEMENT','10000000-0000-0000-0000-000000000002','{"proof":"frozen-evidence"}',null);
do $$ begin
 if (select state from public.recognition_source_states where identity_key='v1:tiktok:111')<>'ELIGIBLE' then raise exception 'agreement did not validate'; end if;
 if (select place_id from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:111' and slot_key='slot-d1')<>'10000000-0000-0000-0000-000000000002' then raise exception 'replacement missing'; end if;
 if (select place_id from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:111' and slot_key='slot-d2')<>'10000000-0000-0000-0000-000000000004' then raise exception 'sibling lost'; end if;
end $$;

-- Cache autosave creates recipient-owned rows/context and zero new votes.
select * from public.commit_recognition_cache_save_v2('00000000-0000-0000-0000-000000000002','v1:tiktok:111',
 array(select id from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:111' order by slot_key),1,
 'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups');
select * from public.commit_recognition_cache_save_v2('00000000-0000-0000-0000-000000000002','v1:tiktok:111',
 array(select id from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:111' order by slot_key),1,
 'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups');
do $$ begin
 if (select count(*) from public.saved_places where user_id='00000000-0000-0000-0000-000000000002')<>2 then raise exception 'recipient save count'; end if;
 if (select count(*) from public.saved_place_sources s join public.saved_places sp on sp.id=s.saved_place_id where sp.user_id='00000000-0000-0000-0000-000000000002' and s.identity_key='v1:tiktok:111')<>2 then raise exception 'recipient source count'; end if;
 if (select count(*) from public.recognition_identity_support where identity_key='v1:tiktok:111')<>1 then raise exception 'cache feedback loop'; end if;
 if exists(select 1 from public.saved_places where user_id='00000000-0000-0000-0000-000000000002' and notes is not null) then raise exception 'private note crossed account'; end if;
end $$;

create table public.cache_v2_race_results(name text primary key,passed boolean not null);
'@
  Invoke-LocalPsql $fixtureSql | Out-Null
  Write-Host 'DB_V2_STAGE fixture_proved'

  # Real two-session race: correction holds the source lock; a save read at
  # revision 1 must wait and then fail its compare-and-save boundary.
  $correctionRace = @'
begin;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select * from public.correct_saved_place_provider_v2('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','g-c','restaurant','test',1,'test','race-correction-111');
select pg_sleep(1.2);
commit;
'@
  $staleSaveRace = @'
do $$ begin
  perform * from public.commit_recognition_cache_save_v2('00000000-0000-0000-0000-000000000003','v1:tiktok:111',
    array(select id from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:111' order by slot_key),1,
    'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups');
  raise exception 'stale save unexpectedly committed';
exception when others then
  if sqlerrm not like '%recognition_cache_stale%' then raise; end if;
  insert into public.cache_v2_race_results values('correction_before_stale_save',true);
end $$;
'@
  $job1 = Start-LocalPsqlJob $correctionRace
  Start-Sleep -Milliseconds 200
  $job2 = Start-LocalPsqlJob $staleSaveRace
  Wait-Job $job1,$job2 | Out-Null
  $raceOutputs = @((Receive-Job $job1),(Receive-Job $job2))
  Remove-Job $job1,$job2
  foreach ($result in $raceOutputs) { if ($result.ExitCode -ne 0) { throw "concurrent race failed: $($result.Output)" } }
  Write-Host 'DB_V2_STAGE correction_save_race_proved'

  # Two real owner corrections against the same source serialize on its state
  # row. Both personal saves commit, history is append-only, and revisions are
  # distinct so only the latest validation can ever win.
  Invoke-LocalPsql @'
insert into public.saved_places(id,user_id,place_id,source_type,source_url) values
 ('20000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','tiktok','https://www.tiktok.com/@proof/video/333'),
 ('20000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','tiktok','https://www.tiktok.com/@proof/video/333');
select public.attach_saved_place_source('00000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000010','v1:tiktok:333',1,'tiktok','333','https://www.tiktok.com/@proof/video/333',null,null,null,null,null,null);
select public.attach_saved_place_source('00000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000011','v1:tiktok:333',1,'tiktok','333','https://www.tiktok.com/@proof/video/333',null,null,null,null,null,null);
insert into public.recognition_source_states(identity_key,platform,content_id,canonical_url,identity_version,policy_version,recognition_version,state)
values('v1:tiktok:333','tiktok','333','https://www.tiktok.com/@proof/video/333',1,'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups','ELIGIBLE');
insert into public.recognition_cache_answers_v2(identity_key,slot_key,place_id,state,feedback_revision,evidence_revision,policy_version,recognition_version,specificity,terminal_status,semantic_check_passed,geographic_check_passed,evidence_sufficient,validated_feedback_revision)
values('v1:tiktok:333','slot-only','10000000-0000-0000-0000-000000000001','ELIGIBLE',0,1,'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups','exact','success',true,true,true,0);
'@
  $simCorrection1 = @'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
select * from public.correct_saved_place_provider_v2('20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','g-b','restaurant','test',1,'test','sim-correction-u3');
'@
  $simCorrection2 = @'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select * from public.correct_saved_place_provider_v2('20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000003','g-c','restaurant','test',1,'test','sim-correction-u4');
'@
  $correction1 = Start-LocalPsqlJob $simCorrection1
  $correction2 = Start-LocalPsqlJob $simCorrection2
  Wait-Job $correction1,$correction2 | Out-Null
  $simOutputs = @((Receive-Job $correction1),(Receive-Job $correction2))
  Remove-Job $correction1,$correction2
  foreach ($result in $simOutputs) { if ($result.ExitCode -ne 0) { throw "simultaneous correction failed: $($result.Output)" } }
  Invoke-LocalPsql @'
do $$ begin
 if (select feedback_revision from public.recognition_source_states where identity_key='v1:tiktok:333')<>2 then raise exception 'corrections not serialized'; end if;
 if (select count(*) from public.recognition_correction_events where identity_key='v1:tiktok:333')<>2 then raise exception 'correction history lost'; end if;
 if (select count(distinct feedback_revision) from public.recognition_revalidation_tasks where identity_key='v1:tiktok:333')<>2 then raise exception 'work revisions collided'; end if;
 if (select count(*) from public.recognition_identity_support where identity_key='v1:tiktok:333')<>2 then raise exception 'unique user support lost'; end if;
end $$;
update public.recognition_revalidation_tasks set state='STALE' where identity_key='v1:tiktok:333';
update public.share_media_tasks set status='completed',completed_at=now() where recognition_revalidation_task_id in
 (select id from public.recognition_revalidation_tasks where identity_key='v1:tiktok:333');
'@
  Write-Host 'DB_V2_STAGE simultaneous_corrections_proved'

  $postRaceSql = @'
do $$ begin
 if not exists(select 1 from public.cache_v2_race_results where name='correction_before_stale_save' and passed) then raise exception 'race proof missing'; end if;
 if exists(select 1 from public.saved_place_sources s join public.saved_places sp on sp.id=s.saved_place_id
   where sp.user_id='00000000-0000-0000-0000-000000000003' and s.identity_key='v1:tiktok:111') then raise exception 'stale save leaked'; end if;
 -- A save completed before the later correction remains historical and is not rewritten.
 if (select count(*) from public.saved_places where user_id='00000000-0000-0000-0000-000000000002' and place_id='10000000-0000-0000-0000-000000000002')<>1 then raise exception 'prior save rewritten'; end if;
end $$;

-- A newer correction makes the earlier model result stale.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select * from public.correct_saved_place_provider_v2(
 (select id from public.saved_places where user_id='00000000-0000-0000-0000-000000000002' and place_id='10000000-0000-0000-0000-000000000002'),
 '10000000-0000-0000-0000-000000000001','g-a','restaurant','test',1,'test','newer-correction-111');
select set_config('request.jwt.claim.sub','',false);
select public.complete_recognition_revalidation_v2(
 (select id from public.recognition_revalidation_tasks where identity_key='v1:tiktok:111' and feedback_revision=2),
 'AGREES_WITH_REPLACEMENT','10000000-0000-0000-0000-000000000003','{}',null);
do $$ begin
 if (select state from public.recognition_revalidation_tasks where identity_key='v1:tiktok:111' and feedback_revision=2)<>'STALE' then raise exception 'stale validation committed'; end if;
 if (select state from public.recognition_source_states where identity_key='v1:tiktok:111')<>'QUARANTINED' then raise exception 'newer correction lost quarantine'; end if;
end $$;

-- Technical failure retains quarantine and schedules bounded retry.
select public.complete_recognition_revalidation_v2(
 (select id from public.recognition_revalidation_tasks where identity_key='v1:tiktok:111' and feedback_revision=3),
 'TECHNICAL_FAILURE',null,'{}','provider_timeout');
do $$ begin
 if (select state from public.recognition_revalidation_tasks where identity_key='v1:tiktok:111' and feedback_revision=3)<>'RETRY_WAIT' then raise exception 'retry not scheduled'; end if;
 if (select state from public.recognition_source_states where identity_key='v1:tiktok:111')<>'QUARANTINED' then raise exception 'outage cleared quarantine'; end if;
end $$;

-- Consensus fixtures: 3-vs-2 is a near tie; 4-vs-1 (including a merged alias)
-- is meaningful; any hard contradiction blocks even the numerical winner.
insert into public.recognition_source_states(identity_key,platform,content_id,canonical_url,identity_version,policy_version,recognition_version,state,feedback_revision)
select 'v1:tiktok:'||k,'tiktok',k,'https://www.tiktok.com/@proof/video/'||k,1,'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups','QUARANTINED',1
from unnest(array['tie','lead','contradiction']) k;
insert into public.recognition_cache_answers_v2(identity_key,slot_key,place_id,state,feedback_revision,evidence_revision,policy_version,recognition_version,specificity,terminal_status,semantic_check_passed,geographic_check_passed,evidence_sufficient,validated_feedback_revision)
select 'v1:tiktok:'||k,'slot','10000000-0000-0000-0000-000000000001','QUARANTINED',1,1,'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups','exact','success',true,true,true,0
from unnest(array['tie','lead','contradiction']) k;
insert into public.recognition_correction_events(id,idempotency_key,user_id,identity_key,slot_key,previous_place_id,replacement_place_id,assertion_kind,feedback_revision) values
 ('50000000-0000-0000-0000-000000000001','consensus-tie','00000000-0000-0000-0000-000000000001','v1:tiktok:tie','slot','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','CORRECTION',1),
 ('50000000-0000-0000-0000-000000000002','consensus-lead','00000000-0000-0000-0000-000000000001','v1:tiktok:lead','slot','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','CORRECTION',1),
 ('50000000-0000-0000-0000-000000000003','consensus-contradiction','00000000-0000-0000-0000-000000000001','v1:tiktok:contradiction','slot','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','CORRECTION',1);
insert into public.recognition_revalidation_tasks(id,identity_key,slot_key,correction_event_id,previous_place_id,replacement_place_id,feedback_revision,evidence_revision,policy_version) values
 ('60000000-0000-0000-0000-000000000001','v1:tiktok:tie','slot','50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1,1,'recognition-cache-v2.1'),
 ('60000000-0000-0000-0000-000000000002','v1:tiktok:lead','slot','50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1,1,'recognition-cache-v2.1'),
 ('60000000-0000-0000-0000-000000000003','v1:tiktok:contradiction','slot','50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1,1,'recognition-cache-v2.1');
insert into public.recognition_identity_support(user_id,identity_key,slot_key,place_id,assertion_kind) values
 ('00000000-0000-0000-0000-000000000001','v1:tiktok:tie','slot','10000000-0000-0000-0000-000000000002','CORRECTION'),
 ('00000000-0000-0000-0000-000000000002','v1:tiktok:tie','slot','10000000-0000-0000-0000-000000000002','CORRECTION'),
 ('00000000-0000-0000-0000-000000000003','v1:tiktok:tie','slot','10000000-0000-0000-0000-000000000002','CORRECTION'),
 ('00000000-0000-0000-0000-000000000004','v1:tiktok:tie','slot','10000000-0000-0000-0000-000000000001','CONFIRMATION'),
 ('00000000-0000-0000-0000-000000000005','v1:tiktok:tie','slot','10000000-0000-0000-0000-000000000001','CONFIRMATION');
-- Make the broad alias resolve to B; canonical grouping must not split its vote.
update public.places set merged_into='10000000-0000-0000-0000-000000000002' where id='10000000-0000-0000-0000-000000000005';
insert into public.recognition_identity_support(user_id,identity_key,slot_key,place_id,assertion_kind)
select u,'v1:tiktok:'||s,'slot',p,'CORRECTION' from (values
 ('00000000-0000-0000-0000-000000000001'::uuid,'lead','10000000-0000-0000-0000-000000000002'::uuid),
 ('00000000-0000-0000-0000-000000000002'::uuid,'lead','10000000-0000-0000-0000-000000000002'::uuid),
 ('00000000-0000-0000-0000-000000000003'::uuid,'lead','10000000-0000-0000-0000-000000000002'::uuid),
 ('00000000-0000-0000-0000-000000000004'::uuid,'lead','10000000-0000-0000-0000-000000000005'::uuid),
 ('00000000-0000-0000-0000-000000000005'::uuid,'lead','10000000-0000-0000-0000-000000000001'::uuid),
 ('00000000-0000-0000-0000-000000000001'::uuid,'contradiction','10000000-0000-0000-0000-000000000002'::uuid),
 ('00000000-0000-0000-0000-000000000002'::uuid,'contradiction','10000000-0000-0000-0000-000000000002'::uuid),
 ('00000000-0000-0000-0000-000000000003'::uuid,'contradiction','10000000-0000-0000-0000-000000000002'::uuid),
 ('00000000-0000-0000-0000-000000000004'::uuid,'contradiction','10000000-0000-0000-0000-000000000005'::uuid),
 ('00000000-0000-0000-0000-000000000005'::uuid,'contradiction','10000000-0000-0000-0000-000000000001'::uuid)
) v(u,s,p);
select public.complete_recognition_revalidation_v2('60000000-0000-0000-0000-000000000001','AGREES_WITH_REPLACEMENT','10000000-0000-0000-0000-000000000002','{"strongContradiction":false}',null);
select public.complete_recognition_revalidation_v2('60000000-0000-0000-0000-000000000002','AGREES_WITH_REPLACEMENT','10000000-0000-0000-0000-000000000002','{"strongContradiction":false}',null);
select public.complete_recognition_revalidation_v2('60000000-0000-0000-0000-000000000003','AGREES_WITH_REPLACEMENT','10000000-0000-0000-0000-000000000002','{"strongContradiction":true}',null);
do $$ begin
 if (select state from public.recognition_source_states where identity_key='v1:tiktok:tie')<>'DISPUTED' then raise exception 'near tie resolved'; end if;
 if (select state from public.recognition_source_states where identity_key='v1:tiktok:lead')<>'ELIGIBLE' then raise exception 'meaningful lead did not resolve'; end if;
 if (select state from public.recognition_source_states where identity_key='v1:tiktok:contradiction')<>'DISPUTED' then raise exception 'contradiction overridden'; end if;
end $$;

-- Ambiguous multi-location scope quarantines every slot rather than guessing.
insert into public.saved_places(id,user_id,place_id,source_type,source_url) values
 ('20000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000001','tiktok','https://www.tiktok.com/@proof/video/444');
select public.attach_saved_place_source('00000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000020','v1:tiktok:444',1,'tiktok','444','https://www.tiktok.com/@proof/video/444',null,null,null,null,null,null);
insert into public.recognition_source_states(identity_key,platform,content_id,canonical_url,identity_version,policy_version,recognition_version,state)
values('v1:tiktok:444','tiktok','444','https://www.tiktok.com/@proof/video/444',1,'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups','ELIGIBLE');
insert into public.recognition_cache_answers_v2(identity_key,slot_key,place_id,state,feedback_revision,evidence_revision,policy_version,recognition_version,specificity,terminal_status,semantic_check_passed,geographic_check_passed,evidence_sufficient,validated_feedback_revision)
select 'v1:tiktok:444',slot,'10000000-0000-0000-0000-000000000001','ELIGIBLE',0,1,'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups','exact','success',true,true,true,0 from unnest(array['slot-a','slot-b']) slot;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',false);
select public.apply_recognition_feedback_v2('20000000-0000-0000-0000-000000000020','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','corrected_place','ambiguous-multi-proof');
select set_config('request.jwt.claim.sub','',false);
do $$ begin
 if not (select whole_source_quarantined from public.recognition_source_states where identity_key='v1:tiktok:444') then raise exception 'ambiguous source not quarantined'; end if;
 if (select count(*) from public.recognition_cache_answers_v2 where identity_key='v1:tiktok:444' and state='QUARANTINED')<>2 then raise exception 'ambiguous slots leaked'; end if;
end $$;
update public.recognition_revalidation_tasks set state='STALE' where identity_key='v1:tiktok:444';
update public.share_media_tasks set status='completed',completed_at=now() where recognition_revalidation_task_id in
 (select id from public.recognition_revalidation_tasks where identity_key='v1:tiktok:444');
-- Old supported no-replacement feedback deletes the personal save but keeps
-- its new task at the same authoritative revision (support removal is not
-- mistaken for a separate account-deletion event).
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000007',false);
select public.reject_saved_place_recognition('20000000-0000-0000-0000-000000000020','wrong_place');
select set_config('request.jwt.claim.sub','',false);
do $$ begin
 if exists(select 1 from public.saved_places where id='20000000-0000-0000-0000-000000000020') then raise exception 'wrong-place save retained'; end if;
 if (select feedback_revision from public.recognition_source_states where identity_key='v1:tiktok:444')<>2 then raise exception 'support delete double revision'; end if;
 if not exists(select 1 from public.recognition_revalidation_tasks where identity_key='v1:tiktok:444' and feedback_revision=2) then raise exception 'wrong-place task stale at creation'; end if;
end $$;
update public.recognition_revalidation_tasks set state='STALE' where identity_key='v1:tiktok:444';
update public.share_media_tasks set status='completed',completed_at=now() where recognition_revalidation_task_id in
 (select id from public.recognition_revalidation_tasks where identity_key='v1:tiktok:444');

-- Legacy rows remain audit-only even if they carry a trusted-sounding label.
insert into public.recognition_cache(identity_key,platform,content_id,canonical_url,identity_version,recognition_version,result_type,trust_level,canonical_place_id)
values('v1:tiktok:legacy','tiktok','legacy','https://www.tiktok.com/@proof/video/legacy',1,'legacy','verified_place','USER_CONFIRMED','10000000-0000-0000-0000-000000000001');
do $$ begin
 if exists(select 1 from public.read_recognition_answers_v2('v1:tiktok:legacy',1,'recognition-cache-v2.1','vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups','00000000-0000-0000-0000-000000000001')) then raise exception 'legacy bypass'; end if;
 if has_table_privilege('authenticated','public.recognition_source_states','select') then raise exception 'RLS privilege leak'; end if;
end $$;

select 'DATABASE_CORE_PASS' result,
 (select count(*) from public.recognition_correction_events) correction_events,
 (select count(*) from public.recognition_identity_support) explicit_support_rows,
 (select count(*) from public.recognition_cache_answers_v2) v2_answers;
'@
  Invoke-LocalPsql $postRaceSql
  Write-Host 'DB_V2_STAGE stale_validation_proved'

  # Real SKIP LOCKED claim race: only one worker can claim the single durable
  # retry after its backoff is made ready.
  Invoke-LocalPsql "update public.recognition_revalidation_tasks set next_attempt_at=now(),state='RETRY_WAIT' where identity_key='v1:tiktok:111' and feedback_revision=3; select public.queue_ready_recognition_revalidations(10); create table public.cache_v2_claim_log(worker text,task_id uuid unique);" | Out-Null
  $claim1 = "insert into public.cache_v2_claim_log select 'worker-1',id from public.claim_media_tasks(1,60);"
  $claim2 = "insert into public.cache_v2_claim_log select 'worker-2',id from public.claim_media_tasks(1,60);"
  $worker1 = Start-LocalPsqlJob $claim1
  $worker2 = Start-LocalPsqlJob $claim2
  Wait-Job $worker1,$worker2 | Out-Null
  $claimOutputs = @((Receive-Job $worker1),(Receive-Job $worker2))
  Remove-Job $worker1,$worker2
  foreach ($result in $claimOutputs) { if ($result.ExitCode -ne 0) { throw "worker claim race failed: $($result.Output)" } }
  Write-Host 'DB_V2_STAGE worker_claim_race_proved'
  Invoke-LocalPsql @'
do $$ begin
 if (select count(*) from public.cache_v2_claim_log)<>1 then raise exception 'SKIP LOCKED duplicate claim'; end if;
end $$;
-- Simulate a crashed claimed worker, prove stale-lease reclaim, then bounded exhaustion recovery.
update public.share_media_tasks set locked_until=now()-interval '1 second' where id=(select task_id from public.cache_v2_claim_log);
select * from public.claim_media_tasks(1,60);
update public.share_media_tasks set attempts=max_attempts,locked_until=now()-interval '1 second' where id=(select task_id from public.cache_v2_claim_log);
select * from public.expire_media_tasks(25);
select public.recover_abandoned_recognition_revalidations_v2(25);
do $$ begin
 if (select state from public.recognition_revalidation_tasks where identity_key='v1:tiktok:111' and feedback_revision=3)<>'FAILED' then raise exception 'abandoned work not bounded'; end if;
 if (select state from public.recognition_source_states where identity_key='v1:tiktok:111')<>'QUARANTINED' then raise exception 'abandonment cleared quarantine'; end if;
end $$;
select 'DATABASE_CONCURRENCY_PASS' result,(select count(*) from public.cache_v2_claim_log) unique_worker_claims;
'@
} finally {
  & "$pgBin\pg_ctl.exe" -D $taskDbDir -m fast -w stop 2>$null
  $resolved = [IO.Path]::GetFullPath($taskDbDir)
  if ($resolved.StartsWith($taskTempRoot,[StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path $resolved -Leaf).StartsWith('nearr-cache-v2-pg-')) {
    [IO.Directory]::Delete($resolved,$true)
  }
}
