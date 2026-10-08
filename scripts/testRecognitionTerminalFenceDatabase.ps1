$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$taskWorkspace = [IO.Path]::GetFullPath((Get-Location).Path)
$taskTempRoot = Join-Path $taskWorkspace '.tmp'
$taskDbDir = Join-Path $taskTempRoot ('terminal-fence-pg-' + [guid]::NewGuid().ToString('N'))
$taskPort = Get-Random -Minimum 56000 -Maximum 56999
$started = $false
New-Item -ItemType Directory -Path $taskDbDir -Force | Out-Null
function Run-Sql([string]$sql) {
  $sqlFile = Join-Path $taskDbDir 'test.sql'
  [IO.File]::WriteAllText($sqlFile, $sql)
  & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f $sqlFile
  if ($LASTEXITCODE -ne 0) { throw 'local SQL proof failed' }
}
try {
  & "$pgBin\initdb.exe" -D (Join-Path $taskDbDir 'data') -A trust -U postgres --no-locale | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
  & "$pgBin\pg_ctl.exe" -D (Join-Path $taskDbDir 'data') -l (Join-Path $taskDbDir 'server.log') -o "-h 127.0.0.1 -p $taskPort" -w start
  if ($LASTEXITCODE -ne 0) { throw 'pg_ctl failed' }
  $started = $true
  Run-Sql @'
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.places(id uuid primary key default gen_random_uuid(),google_place_id text unique,name text,formatted_address text,latitude numeric,longitude numeric,category text);
create table public.saved_places(id uuid primary key default gen_random_uuid(),user_id uuid,place_id uuid,radius_value numeric,radius_unit text,source_type text,source_url text,ai_note text,unique(user_id,place_id));
create table public.share_jobs(id uuid primary key,user_id uuid,status text,candidate_payload jsonb,saved_place_id uuid,source_platform text,canonical_url text,source_url text,recognition_identity_key text,recognition_identity_version integer,recognition_content_id text,decision text,progress_stage text,suggested_query text,needs_help_reason text,completed_at timestamptz,updated_at timestamptz,resolution_source text);
create table public.share_job_place_results(id uuid primary key default gen_random_uuid(),share_job_id uuid,user_id uuid,logical_result_id text,google_place_id text,place_id uuid,saved_place_id uuid,original_saved_place_id uuid,outcome text,origin text,confidence_score numeric,rule_version text,reason_codes jsonb,finalized_at timestamptz,result_role text,candidate_rank smallint,candidate_snapshot jsonb,updated_at timestamptz,unique(share_job_id,logical_result_id));
-- No source identity is set in these fixtures; attachment must not be called.
create function public.attach_saved_place_source(uuid,uuid,text,integer,text,text,text,text,text,text,text,text,text) returns void language plpgsql as $$ begin raise exception 'unexpected_attachment'; end $$;
grant usage on schema auth to authenticated;
'@
  foreach ($migration in @(
    '20260907000001_named_lead_automatic_completion.sql',
    '20260907000002_fix_named_lead_saved_place_ambiguity.sql',
    '20260907000003_fix_named_lead_job_pointer_ambiguity.sql',
    '20260914000001_recognition_geography_state_consistency.sql',
    '20261008000001_recognition_named_lead_terminal_fence.sql'
  )) {
    & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path 'supabase/migrations' $migration) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "migration failed: $migration" }
  }
  Run-Sql @'
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into public.share_jobs(id,user_id,status,source_platform,source_url,candidate_payload)
values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','needs_help','instagram','https://example.test/source',
'{"mentionSlots":[{"mentionId":"one","identityHypotheses":[{"name":"Example Cafe","evidenceKind":"observable","upstreamSafetyDecision":"AUTO_SAVE","confidence":0.91}]}]}'::jsonb);
do $$
declare c record; r record; status_case text; before_count bigint;
begin
  for status_case in select unnest(array['failed','cancelled','completed','queued','processing_metadata']) loop
    update public.share_jobs set status=status_case where id='10000000-0000-0000-0000-000000000001';
    if exists(select 1 from public.claim_named_lead_auto_recovery('10000000-0000-0000-0000-000000000001','one','test')) then raise exception 'terminal claim admitted: %',status_case; end if;
  end loop;
  update public.share_jobs set status='needs_help' where id='10000000-0000-0000-0000-000000000001';
  select * into c from public.claim_named_lead_auto_recovery('10000000-0000-0000-0000-000000000001','one','test');
  if c.attempt_token is null then raise exception 'positive claim missing'; end if;
  -- A failure arriving while the provider runs must defeat its old result.
  update public.share_jobs set status='failed' where id='10000000-0000-0000-0000-000000000001';
  begin
    perform * from public.auto_complete_named_lead('10000000-0000-0000-0000-000000000001','one',c.attempt_token,'example','Example Cafe','LA',34,-118,'cafe','{}'::jsonb,1,'client-overconfidence');
    raise exception 'failed result saved';
  exception when others then
    if sqlerrm <> 'share_job_not_recoverable' then raise; end if;
  end;
  if exists(select 1 from public.saved_places) then raise exception 'failed job mutated saves'; end if;
  update public.share_jobs set status='needs_help' where id='10000000-0000-0000-0000-000000000001';
  select * into r from public.auto_complete_named_lead('10000000-0000-0000-0000-000000000001','one',c.attempt_token,'example','Example Cafe','LA',34,-118,'cafe','{"name":"Example Cafe"}'::jsonb,1,'client-overconfidence');
  if r.saved_place_id is null or not r.completed then raise exception 'positive save missing'; end if;
  if (select confidence_score from public.share_job_place_results limit 1)<>0.91 then raise exception 'client promoted confidence'; end if;
  if (select status from public.share_jobs limit 1)<>'completed' then raise exception 'save status inconsistent'; end if;
  select * into r from public.auto_complete_named_lead('10000000-0000-0000-0000-000000000001','one',c.attempt_token,'example','Example Cafe','LA',34,-118,'cafe','{}'::jsonb,1,'client-overconfidence');
  if not r.idempotent then raise exception 'completed retry not idempotent'; end if;
  begin
    perform * from public.auto_complete_named_lead('10000000-0000-0000-0000-000000000001','one',c.attempt_token,'other','Other Cafe','LA',34,-118,'cafe','{}'::jsonb,1,'client-overconfidence');
    raise exception 'completed candidate replaced';
  exception when others then
    if sqlerrm <> 'share_job_not_recoverable' then raise; end if;
  end;
  if (select count(*) from public.saved_places)<>1 or (select count(*) from public.places)<>1 then raise exception 'idempotency created extra rows'; end if;
  if has_function_privilege('anon','public.auto_complete_named_lead(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)','execute') then raise exception 'anonymous mutation allowed'; end if;
  if has_function_privilege('authenticated','public.auto_complete_named_lead_v1_unsafe(uuid,text,uuid,text,text,text,numeric,numeric,text,jsonb,numeric,text)','execute') then raise exception 'unsafe bypass exposed'; end if;
end $$;
select 'PASS terminal fence, late failure, positive save, server confidence, idempotence, grants' as result;
'@
} finally {
  if ($started) { & "$pgBin\pg_ctl.exe" -D (Join-Path $taskDbDir 'data') -m fast -w stop | Out-Null }
  $resolved = [IO.Path]::GetFullPath($taskDbDir)
  if ($resolved.StartsWith($taskTempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf).StartsWith('terminal-fence-pg-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
