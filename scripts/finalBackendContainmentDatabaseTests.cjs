/** Called only inside the existing no-network disposable restore harness.
 * Never reads credentials, sends network requests or logs user rows.
 */
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const {output}=require('./finalBackendReadiness.cjs');
const file=join(output,'containment/pause-queue.sql');
function run(sql){
  const tests=[];
  const snapshot=()=>sql(`select json_build_object(
    'users',(select md5(coalesce(string_agg(md5(row_to_json(x)::text),',' order by id),'')) from auth.users x),
    'saves',(select md5(coalesce(string_agg(md5(row_to_json(x)::text),',' order by id),'')) from saved_places x),
    'sources',(select md5(coalesce(string_agg(md5(row_to_json(x)::text),',' order by id),'')) from saved_place_sources x),
    'jobs',(select md5(coalesce(string_agg(md5(row_to_json(x)::text),',' order by id),'')) from share_jobs x),
    'tasks',(select md5(coalesce(string_agg(md5(row_to_json(x)::text),',' order by id),'')) from share_media_tasks x),
    'wallets',(select md5(coalesce(string_agg(md5(row_to_json(x)::text),',' order by user_id),'')) from place_find_wallets x),
    'notification_contract',(select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.proname)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%notification%' or p.proname='claim_share_job_receipts')),
    'transfer_contract',(select md5(string_agg(pg_get_functiondef(p.oid),',' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and (p.proname like '%transfer%' or p.proname like '%onboarding%')),
    'triggers',(select md5(string_agg(pg_get_triggerdef(t.oid),',' order by t.oid)) from pg_trigger t where not t.tgisinternal and t.tgname not like 'nearr_containment_%'),
    'rls',(select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('saved_places','saved_place_sources','share_jobs','share_media_tasks'))
  );`);
  const before=snapshot();
  sql(readFileSync(file,'utf8'));
  assert.equal(snapshot(),before);tests.push('Applying containment changes no user/save/source/job/task/wallet row, existing trigger, notification function or RLS flag');
  const denied=(statement)=>`begin begin ${statement}; raise exception 'EXPECTED_DENIAL_MISSING'; exception when sqlstate 'PT503' then null; end; end`;
  function test(name,body){sql(`begin; set local statement_timeout='10s'; ${body}; rollback;`);assert.equal(snapshot(),before);tests.push(name);}
  test('Direct share-job INSERT and public creation RPC fail closed with no wallet mutation',`do $$ ${denied(`insert into share_jobs(user_id,source_url,canonical_url,status) select id,'https://fixture.invalid/a','https://fixture.invalid/a','queued' from auth.users limit 1`)} $$;
    do $$ declare u uuid; begin select id into u from auth.users limit 1;
      begin perform * from create_share_job_for_user(u,'https://fixture.invalid/new','https://fixture.invalid/new','link','containment-test-new',90,false,true);
      raise exception 'EXPECTED_DENIAL_MISSING'; exception when sqlstate 'PT503' then null; end; end $$`);
  test('New recognition media task is denied; optional AI-note INSERT is skipped without an error or row',`do $$ ${denied(`insert into share_media_tasks(task_kind) values('recognition')`)} $$;
    do $$ declare b bigint; begin select count(*) into b from share_media_tasks;
      insert into share_media_tasks(task_kind) values('ai_note_enrichment');
      if (select count(*) from share_media_tasks)<>b then raise exception 'ENRICHMENT_ENQUEUED'; end if; end $$`);
  // Fixture seeding bypasses only local triggers, before returning to origin.
  // The real Production claim RPCs and newly installed guards then execute.
  const seed=`set local session_replication_role=replica;
    insert into share_jobs(id,user_id,source_url,canonical_url,source_platform,status,attempts,max_attempts)
      select '00000000-0000-4000-8000-000000000071',id,'https://fixture.invalid/queued','https://fixture.invalid/queued','youtube','queued',0,3 from auth.users limit 1;
    insert into share_media_tasks(id,share_job_id,user_id,source_url,canonical_url,platform,status,task_kind,attempts,max_attempts)
      select '00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000071',user_id,source_url,canonical_url,'youtube','queued','recognition',0,3 from share_jobs where id='00000000-0000-4000-8000-000000000071';
    set local session_replication_role=origin;`;
  test('Actual share-job claim RPC cannot lease queued work',seed+`do $$ ${denied(`perform * from claim_share_jobs(10000,120)`)} $$`);
  test('Actual media claim RPC cannot lease queued recognition work',seed+`set local session_replication_role=replica;
    update share_jobs set status='processing_metadata' where id='00000000-0000-4000-8000-000000000071';
    set local session_replication_role=origin;
    do $$ ${denied(`perform * from claim_media_tasks(10000,600)`)} $$`);
  const expiredSeed=seed+`set local session_replication_role=replica;
    update share_jobs set status='processing_metadata',locked_until=now()-interval '1 hour',attempts=1 where id='00000000-0000-4000-8000-000000000071';
    update share_media_tasks set status='processing',locked_at=now()-interval '2 hours',locked_until=now()-interval '1 hour',attempts=1 where id='00000000-0000-4000-8000-000000000072';
    set local session_replication_role=origin;`;
  test('Actual share-job and media claim RPCs deny expired processing reclaims with unchanged status',expiredSeed+`do $$ ${denied(`perform * from claim_share_jobs(10000,120)`)} $$;
    do $$ ${denied(`perform * from claim_media_tasks(10000,600)`)} $$;
    do $$ ${denied(`update share_jobs set locked_until=now()+interval '2 minutes' where id='00000000-0000-4000-8000-000000000071'`)} $$;
    do $$ ${denied(`update share_media_tasks set attempts=attempts+1 where id='00000000-0000-4000-8000-000000000072'`)} $$`);
  test('Direct retry/reclaim status, attempts and lease writes are denied',seed+`do $$ ${denied(`update share_jobs set status='processing_metadata',attempts=attempts+1,locked_until=now()+interval '2 minutes' where id='00000000-0000-4000-8000-000000000071'`)} $$;
    do $$ ${denied(`update share_media_tasks set status='processing',attempts=attempts+1,locked_until=now()+interval '10 minutes' where id='00000000-0000-4000-8000-000000000072'`)} $$`);
  test('User cancellation and existing media cancellation cascade still work',seed+`update share_jobs set status='cancelled' where id='00000000-0000-4000-8000-000000000071';
    do $$ begin if (select status from share_media_tasks where id='00000000-0000-4000-8000-000000000072')<>'cancelled' then raise exception 'CANCELLATION_BROKEN'; end if; end $$`);
  test('Manual completion and notification-only updates remain possible',seed+`update share_jobs set status='completed' where id='00000000-0000-4000-8000-000000000071';
    update share_jobs set notification_error_code='offline-containment-test' where id='00000000-0000-4000-8000-000000000071'`);
  test('Existing job/media ownership updates remain possible under the unchanged Production owner guard',seed+`do $$ declare u uuid; begin
    select id into u from auth.users where id<>(select user_id from share_jobs where id='00000000-0000-4000-8000-000000000071') limit 1;
    if u is null then raise exception 'SECOND_OWNER_FIXTURE_MISSING'; end if;
    update share_jobs set user_id=u where id='00000000-0000-4000-8000-000000000071';
    update share_media_tasks set user_id=u where id='00000000-0000-4000-8000-000000000072';
    if (select user_id from share_media_tasks where id='00000000-0000-4000-8000-000000000072')<>u then raise exception 'OWNER_TRANSFER_BROKEN'; end if;
    end $$`);
  test('Normal auth user insert executes existing signup trigger without containment interference',`insert into auth.users(id,is_anonymous,aud,role,email,raw_user_meta_data)
    values('00000000-0000-4000-8000-000000000074',false,'authenticated','authenticated','containment-fixture@example.invalid','{"full_name":"Offline containment fixture"}'::jsonb);
    do $$ begin if not exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000000074') then raise exception 'SIGNUP_INSERT_FAILED'; end if; end $$`);
  test('Production notification begin is at-most-once and delivery_unknown finish/receipt branches remain callable',seed+`update share_jobs set status='completed',
    notification_status='sending',notification_attempt_id='00000000-0000-4000-8000-000000000075',
    notification_logical_id='n1:00000000-0000-4000-8000-000000000071:c',
    notification_payload='{"data":{"jobId":"00000000-0000-4000-8000-000000000071","type":"share_job_completed"}}'::jsonb
    where id='00000000-0000-4000-8000-000000000071';
    do $$ declare n integer; ok boolean; begin
      select count(*) into n from begin_share_job_notification_provider_attempt('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000075');
      if n<>1 then raise exception 'NOTIFICATION_BEGIN_FAILED'; end if;
      select count(*) into n from begin_share_job_notification_provider_attempt('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000075');
      if n<>0 then raise exception 'NOTIFICATION_BEGIN_DUPLICATE'; end if;
      select finish_share_job_notification_provider_attempt('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000075','delivery_unknown','[{"id":"offline-ticket"}]'::jsonb,'offline-test') into ok;
      if not ok then raise exception 'NOTIFICATION_FINISH_FAILED'; end if;
      perform * from claim_share_job_receipts(10000,90);
      if not exists(select 1 from share_jobs where id='00000000-0000-4000-8000-000000000071' and notification_status='delivery_unknown' and notification_receipts_checked_at is not null) then raise exception 'NOTIFICATION_RECEIPT_LOST'; end if;
    end $$`);
  test('A real video-source saved-place INSERT succeeds while its automatic AI-note enqueue is skipped',`set local session_replication_role=replica;
    insert into auth.users(id,is_anonymous) values('00000000-0000-4000-8000-000000000073',false);
    set local session_replication_role=origin;
    do $$ declare s public.saved_places%rowtype; n bigint; new_id uuid:=gen_random_uuid(); begin
      select * into s from saved_places where public.is_video_derived_saved_place(source_type,source_url) limit 1;
      if s.id is null then raise exception 'VIDEO_SAVE_FIXTURE_MISSING'; end if;
      select count(*) into n from share_media_tasks;
      s.id:=new_id;s.user_id:='00000000-0000-4000-8000-000000000073';s.ai_note:=null;
      insert into saved_places select s.*;
      if not exists(select 1 from saved_places where id=new_id) then raise exception 'MANUAL_SAVE_LOST'; end if;
      if (select count(*) from share_media_tasks)<>n then raise exception 'OPTIONAL_AI_ENQUEUED'; end if;
    end $$`);
  test('Actual media claim RPC denies an eligible premium-recognition fixture',seed+`set local session_replication_role=replica;
    update share_media_tasks set status='cancelled';
    update share_jobs set status='processing_metadata',premium_request_id='00000000-0000-4000-8000-000000000076' where id='00000000-0000-4000-8000-000000000071';
    update share_media_tasks set task_kind='premium_recognition',premium_request_id='00000000-0000-4000-8000-000000000076',status='queued' where id='00000000-0000-4000-8000-000000000072';
    set local session_replication_role=origin;
    do $$ ${denied(`perform * from claim_media_tasks(10000,600)`)} $$`);
  test('Actual media claim RPC denies an eligible revalidation fixture',`set local session_replication_role=replica;
    update share_media_tasks set status='cancelled';
    insert into recognition_revalidation_tasks(id,identity_key,slot_key,correction_event_id,previous_place_id,feedback_revision,evidence_revision,policy_version,state,next_attempt_at)
      values('00000000-0000-4000-8000-000000000077','offline-fixture','offline','00000000-0000-4000-8000-000000000078','00000000-0000-4000-8000-000000000079',1,1,'offline','QUEUED',now()-interval '1 minute');
    insert into share_media_tasks(id,task_kind,recognition_revalidation_task_id,user_id,source_url,canonical_url,platform,status,attempts,max_attempts)
      select '00000000-0000-4000-8000-000000000080','recognition_revalidation','00000000-0000-4000-8000-000000000077',id,'https://fixture.invalid/revalidation','https://fixture.invalid/revalidation','youtube','queued',0,3 from auth.users limit 1;
    set local session_replication_role=origin;
    do $$ ${denied(`perform * from claim_media_tasks(10000,600)`)} $$`);
  test('Actual media claim RPC denies an existing eligible AI-note task',`set local session_replication_role=replica;
    update share_media_tasks set status='cancelled';
    do $$ declare t public.share_media_tasks%rowtype; s public.saved_places%rowtype; begin
      select mt.* into t from share_media_tasks mt join saved_places sp on sp.id=mt.saved_place_id where mt.task_kind='ai_note_enrichment' and public.is_video_derived_saved_place(sp.source_type,sp.source_url) limit 1;
      if t.id is null then raise exception 'EXISTING_AI_NOTE_FIXTURE_MISSING'; end if;
      select * into s from saved_places where id=t.saved_place_id;
      update saved_places set ai_note=null where id=s.id;
      update share_media_tasks set status='queued',attempts=0,max_attempts=3,next_attempt_at=now()-interval '1 minute',user_id=s.user_id,target_place_id=s.place_id,source_url=s.source_url,canonical_url=s.source_url where id=t.id;
    end $$;
    set local session_replication_role=origin;
    do $$ ${denied(`perform * from claim_media_tasks(10000,600)`)} $$`);
  test('Optional AI-note ON CONFLICT rearm cannot rewrite existing task payload or status',`do $$ declare t public.share_media_tasks%rowtype; begin
    select * into t from share_media_tasks where task_kind='ai_note_enrichment' limit 1;
    if t.id is null then raise exception 'ENRICHMENT_FIXTURE_MISSING'; end if;
    insert into share_media_tasks(task_kind,saved_place_id,user_id,target_place_id,source_url,canonical_url,platform,status)
      values('ai_note_enrichment',t.saved_place_id,t.user_id,t.target_place_id,t.source_url,t.canonical_url,t.platform,'queued')
      on conflict(saved_place_id) where task_kind='ai_note_enrichment' do update set status='queued',attempts=0;
    if (select row_to_json(x)::text from share_media_tasks x where id=t.id) is distinct from row_to_json(t)::text then raise exception 'EXISTING_TASK_CHANGED'; end if;
    end $$`);
  return {passed:true,tests,sqlSha256:createHash('sha256').update(readFileSync(file)).digest('hex'),userRowsEmitted:false,scope:'Historical private Production backup restored into a new local network-none container; not a live cutover'};
}
module.exports={run};
