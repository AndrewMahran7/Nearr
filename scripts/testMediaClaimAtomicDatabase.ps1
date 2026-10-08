$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$taskWorkspace = [IO.Path]::GetFullPath((Get-Location).Path)
$taskTempRoot = Join-Path $taskWorkspace '.tmp'
$taskDbDir = Join-Path $taskTempRoot ('media-claim-pg-' + [guid]::NewGuid().ToString('N'))
$taskPort = Get-Random -Minimum 57000 -Maximum 57999
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
create table public.places(id uuid primary key default gen_random_uuid(),google_place_id text unique,name text,formatted_address text,latitude numeric,longitude numeric,category text,google_maps_url text,short_formatted_address text,google_primary_type text,google_types text[],google_type_label text,business_status text);
create table public.saved_places(id uuid primary key default gen_random_uuid(),user_id uuid,place_id uuid,radius_value numeric,radius_unit text,source_type text,source_url text,notes text,ai_note text,category text,category_source text,category_confidence numeric,category_model_version text,categorized_at timestamptz,category_user_overridden boolean default false,updated_at timestamptz,unique(user_id,place_id));
create table public.share_jobs(id uuid primary key,user_id uuid,status text,saved_place_id uuid,decision text,candidate_payload jsonb,created_at timestamptz,source_url text);
create table public.share_media_tasks(id uuid primary key,share_job_id uuid,user_id uuid,attempts integer,locked_at timestamptz,status text);
create table public.share_media_runs(id uuid primary key,share_job_id uuid,share_media_task_id uuid,user_id uuid);
create table public.share_job_place_results(id uuid primary key default gen_random_uuid(),share_job_id uuid,share_media_task_id uuid,share_media_run_id uuid,user_id uuid,logical_result_id text,google_place_id text,place_id uuid,saved_place_id uuid,original_saved_place_id uuid,outcome text,origin text,confidence_score numeric,rule_version text,reason_codes jsonb,finalized_at timestamptz,result_role text,candidate_rank smallint,candidate_snapshot jsonb,updated_at timestamptz,unique(share_job_id,logical_result_id));
create table source_attachments(saved_place_id uuid,identity_key text,unique(saved_place_id,identity_key));
create table public.place_video_media(place_id uuid,identity_key text,identity_version integer,platform text,content_id text,canonical_url text,original_url text,creator_handle text,creator_name text,representative_frame_storage_path text,representative_frame_timestamp_seconds numeric,community_visibility text,source_reachability text,public_access_verified_at timestamptz,is_synthetic boolean,last_seen_at timestamptz,unique(place_id,identity_key));
-- External attachment implementation is replaced by a deterministic transaction probe.
-- It records attachment or throws, proving candidate/save/ledger/source rollback together.
create function public.attach_saved_place_source(uuid,uuid,text,integer,text,text,text,text,text,text,text,text,text) returns void language plpgsql as $$ begin
  if $3='fail-attachment' then raise exception 'fixture_attachment_failure'; end if;
  insert into source_attachments values($2,$3) on conflict do nothing;
end $$;
insert into share_jobs values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','processing_metadata',null,null,null,now(),'https://example.test/source');
insert into share_media_tasks values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',2,'2026-10-08T18:00:00Z','processing');
'@
  foreach ($migration in @('20260815000001_saved_place_source_type_platforms.sql','20261008000002_media_claim_atomic_writes.sql')) {
    & "$pgBin\psql.exe" -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $taskPort -U postgres -d postgres -f (Join-Path 'supabase/migrations' $migration) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "migration failed: $migration" }
  }
  Run-Sql @'
create function pg_temp.payload(key text default 'fixture-source') returns jsonb language sql as $$ select jsonb_build_object(
  'candidate','{"googlePlaceId":"fixture-place","name":"Fixture Cafe","latitude":34,"longitude":-118,"primaryType":"cafe","types":["cafe"],"googleMapsTypeLabel":"Cafe","shortFormattedAddress":"LA","businessStatus":"OPERATIONAL"}'::jsonb,
  'categoryResolution','{"category":"cafe","source":"google_primary_type","confidence":0.95,"modelVersion":"test"}'::jsonb,
  'logicalResultId','one','source','instagram','sourceUrl','https://example.test/source','confidenceScore',0.95,'ruleVersion','test',
  'identity',jsonb_build_object('key',key,'identityVersion',1,'contentId','fixture','canonicalUrl','https://example.test/source'), 'autoNote','fixture note') $$;
do $$
declare j constant uuid:='10000000-0000-0000-0000-000000000001'; t constant uuid:='20000000-0000-0000-0000-000000000001';
  claim_time constant timestamptz:='2026-10-08T18:00:00Z'; s text; r record; rows jsonb;
begin
  foreach s in array array['queued','cancelled','failed','completed'] loop
    update share_media_tasks set status=s where id=t;
    begin perform public.commit_media_claim_candidate(j,t,2,claim_time,pg_temp.payload()); raise exception 'obsolete task saved';
    exception when others then if sqlerrm<>'obsolete_media_claim' then raise; end if; end;
    begin perform public.finalize_media_claim_parent(j,t,2,claim_time,'{"status":"completed"}'); raise exception 'obsolete task finalized';
    exception when others then if sqlerrm<>'obsolete_media_claim' then raise; end if; end;
  end loop;
  update share_media_tasks set status='processing' where id=t;
  begin perform public.commit_media_claim_candidate(j,t,1,claim_time,pg_temp.payload()); raise exception 'old attempt saved';
  exception when others then if sqlerrm<>'obsolete_media_claim' then raise; end if; end;
  begin perform public.commit_media_claim_candidate(j,t,2,claim_time-interval '1 second',pg_temp.payload()); raise exception 'old timestamp saved';
  exception when others then if sqlerrm<>'obsolete_media_claim' then raise; end if; end;
  foreach s in array array['failed','cancelled','completed','needs_help'] loop
    update share_jobs set status=s where id=j;
    begin perform public.commit_media_claim_candidate(j,t,2,claim_time,pg_temp.payload()); raise exception 'terminal parent saved';
    exception when others then if sqlerrm<>'obsolete_media_claim' then raise; end if; end;
  end loop;
  update share_jobs set status='processing_metadata' where id=j;
  begin perform public.commit_media_claim_candidate(j,t,2,claim_time,pg_temp.payload('fail-attachment')); raise exception 'attachment failure ignored';
  exception when others then if sqlerrm<>'fixture_attachment_failure' then raise; end if; end;
  if exists(select 1 from saved_places) or exists(select 1 from places) or exists(select 1 from share_job_place_results) then raise exception 'transaction rollback leaked rows'; end if;
  select * into r from public.commit_media_claim_candidate(j,t,2,claim_time,pg_temp.payload());
  if r.saved_place_id is null or (select count(*) from source_attachments)<>1 then raise exception 'positive save/attachment missing'; end if;
  if not exists(select 1 from places where google_primary_type='cafe' and google_types=array['cafe'] and business_status='OPERATIONAL') then raise exception 'canonical metadata missing'; end if;
  perform public.promote_media_claim_video(j,t,2,claim_time,jsonb_build_object('place_id',r.place_id,'identity_key','fixture-source','community_visibility','OWNER_ONLY'));
  perform public.promote_media_claim_video(j,t,2,claim_time,jsonb_build_object('place_id',r.place_id,'identity_key','fixture-source','community_visibility','PUBLIC_SOURCE_ELIGIBLE'));
  if (select community_visibility from place_video_media)<>'OWNER_ONLY' then raise exception 'private media made public'; end if;
  update saved_places set category='user-choice',category_user_overridden=true,notes='user note';
  perform public.commit_media_claim_candidate(j,t,2,claim_time,pg_temp.payload());
  perform public.commit_media_claim_candidate(j,t,2,claim_time,jsonb_set(pg_temp.payload(),'{candidate,types}','[]'));
  if (select google_types from places limit 1)<>array['cafe'] then raise exception 'empty types erased canonical metadata'; end if;
  if (select count(*) from saved_places)<>1 or (select count(*) from share_job_place_results)<>1 then raise exception 'retry duplicated save'; end if;
  if not exists(select 1 from saved_places where category='user-choice' and notes='user note' and ai_note='fixture note') then raise exception 'user category/note overwritten'; end if;
  perform public.commit_media_claim_candidate(j,t,2,claim_time,jsonb_set(pg_temp.payload(),'{autoNote}','"replacement cue"'));
  if (select ai_note from saved_places limit 1)<>'fixture note' then raise exception 'existing AI note overwritten'; end if;
  update saved_places set source_url='https://example.test/other-post',ai_note=null;
  perform public.commit_media_claim_candidate(j,t,2,claim_time,pg_temp.payload());
  if exists(select 1 from saved_places where ai_note is not null or source_url<>'https://example.test/other-post') then raise exception 'different source received incoming cue'; end if;
  update saved_places set source_url='https://example.test/source';
  perform public.commit_media_claim_candidate(j,t,2,claim_time,jsonb_set(pg_temp.payload(),'{autoNote}','""'));
  if exists(select 1 from saved_places where ai_note is not null) then raise exception 'empty note persisted'; end if;
  perform public.commit_media_claim_candidate(j,t,2,claim_time,pg_temp.payload());
  if (select ai_note from saved_places limit 1)<>'fixture note' then raise exception 'same source note not attached'; end if;
  rows:=jsonb_build_array(jsonb_build_object('share_job_id',j,'share_media_task_id',t,'user_id','00000000-0000-0000-0000-000000000099','logical_result_id','bad-owner','outcome','candidate_confirmation'));
  begin perform public.write_media_claim_results(j,t,2,claim_time,rows); raise exception 'foreign owner accepted';
  exception when others then if sqlerrm<>'invalid_result_owner' then raise; end if; end;
  rows:=jsonb_set(rows,'{0,user_id}','"00000000-0000-0000-0000-000000000001"');
  perform public.write_media_claim_results(j,t,2,claim_time,rows);
  -- User correction wins before later ledger/terminal write.
  update share_jobs set status='completed',decision='user_selected' where id=j;
  begin perform public.promote_media_claim_video(j,t,2,claim_time,jsonb_build_object('place_id',r.place_id,'identity_key','late-source')); raise exception 'late gallery accepted';
  exception when others then if sqlerrm<>'obsolete_media_claim' then raise; end if; end;
  begin perform public.write_media_claim_results(j,t,2,claim_time,rows); raise exception 'late ledger accepted';
  exception when others then if sqlerrm<>'obsolete_media_claim' then raise; end if; end;
  begin perform public.finalize_media_claim_parent(j,t,2,claim_time,'{"status":"completed","decision":"auto_save"}'); raise exception 'late finalize accepted';
  exception when others then if sqlerrm<>'obsolete_media_claim' then raise; end if; end;
  if (select decision from share_jobs where id=j)<>'user_selected' then raise exception 'correction overwritten'; end if;
  update share_jobs set status='processing_metadata' where id=j;
  perform public.finalize_media_claim_parent(j,t,2,claim_time,'{"status":"completed","decision":"auto_save"}');
  if (select status from share_jobs where id=j)<>'completed' then raise exception 'positive finalize missing'; end if;
  if has_function_privilege('authenticated','public.commit_media_claim_candidate(uuid,uuid,integer,timestamptz,jsonb)','execute') then raise exception 'client write exposed'; end if;
  if not has_function_privilege('service_role','public.commit_media_claim_candidate(uuid,uuid,integer,timestamptz,jsonb)','execute') then raise exception 'service grant missing'; end if;
end $$;
select 'PASS task/attempt/time/parent fences, candidate+ledger+source rollback, positive save, metadata, idempotency, user edits, owner check, late correction, finalization, grants' as result;
'@
} finally {
  if ($started) { & "$pgBin\pg_ctl.exe" -D (Join-Path $taskDbDir 'data') -m fast -w stop | Out-Null }
  $resolved = [IO.Path]::GetFullPath($taskDbDir)
  if ($resolved.StartsWith($taskTempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf).StartsWith('media-claim-pg-')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
